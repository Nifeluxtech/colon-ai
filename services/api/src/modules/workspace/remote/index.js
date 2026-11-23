// Server access to a workspace's connected database (v0.31.0). One adapter per service (supabase.js, firebase.js,
// appwrite.js, pocketbase.js), all with the same operations, run with the credentials data.js decrypts for the
// workspace owner only. Used by the Data tab (tables, rows) and the Workspace chat's tool blocks (tools.js).
//
//   op shapes   { op: 'tables' } · { op: 'select', table, where?, limit?, order?, columns? }
//               { op: 'insert', table, rows: [{…}] } · { op: 'update', table, where, values }
//               { op: 'delete', table, where } · { op: 'createTable', table, columns: [{ name, type, required? }] }
//               { op: 'addColumn', table, column: { name, type } } · { op: 'sql', sql } (Supabase with a token)
//   guard       dropping or truncating a table, and an update or delete with no filter, are refused unless the
//               user's own message asks for it (allowDestructive, decided by tools.js from that message).
const { supabase } = require('./supabase');
const { firebase } = require('./firebase');
const { appwrite } = require('./appwrite');
const { pocketbase } = require('./pocketbase');
const { createHttp } = require('./http');

const ADAPTERS = { supabase, firebase, appwrite, pocketbase };
const READS = ['tables', 'select'];
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const DANGER_SQL = /\b(drop\s+(table|schema|database|view)|truncate)\b|\bdelete\s+from\s+[\w."]+\s*(;|$)/i;

const isReadSql = (s) => /^\s*(select|with|show|explain)\b/i.test(String(s)) && !/;\s*\S/.test(String(s).trim()
  .replace(/;\s*$/, ''));
const isRead = (o) => Boolean(o) && (READS.includes(o.op) || (o.op === 'sql' && isReadSql(o.sql)));
const empty = (w) => !w || typeof w !== 'object' || !Object.keys(w).length;

function guard(o, allow) {
  if (allow) return;
  if ((o.op === 'delete' || o.op === 'update') && empty(o.where)) {
    throw err(403, 'destructive', `Colon won’t ${o.op} every row of “${o.table}” unless you ask for that in your `
      + 'message.');
  }
  if (o.op === 'sql' && DANGER_SQL.test(String(o.sql))) {
    throw err(403, 'destructive', 'Colon won’t drop or empty a table unless you ask for that in your message.');
  }
}

function createRemote({ data, http = createHttp() }) {
  async function adapter(u, id, provider) {
    if (!ADAPTERS[provider]) throw err(404, 'not_found', 'Colon can’t work in that service’s database.');
    const c = await data.credentials(u, id, provider);
    return { a: ADAPTERS[provider](c, http), c };
  }
  async function run(u, id, provider, o = {}, { allowDestructive = false } = {}) {
    const op = String(o.op || (o.sql ? 'sql' : ''));
    const x = { ...o, op };
    guard(x, allowDestructive);
    const { a } = await adapter(u, id, provider);
    switch (op) {
      case 'tables': return { tables: await a.tables() };
      case 'select': return a.rows(x.table, x);
      case 'insert': return a.insert(x.table, x.rows || x.row || x.values || []);
      case 'update': return a.update(x.table, x.where, x.values || {});
      case 'delete': return a.remove(x.table, x.where);
      case 'createTable': return a.createTable(x.table, x.columns || []);
      case 'addColumn': return a.addColumn(x.table, x.column || {});
      case 'sql':
        if (!a.sql) throw err(422, 'no_sql', `${a.label} doesn’t take SQL. Use the table operations.`);
        return a.sql(x.sql);
      default: throw err(422, 'invalid', `Unknown database operation “${op.slice(0, 20)}”.`);
    }
  }
  // the Data tab
  const tables = (u, id, provider) => run(u, id, provider, { op: 'tables' });
  const rows = (u, id, provider, table) => run(u, id, provider, { op: 'select', table, limit: 50 });
  // a short schema for the chat prompt: "orders(id, total, status) 128 rows"
  async function schema(u, id, provider) {
    const { a } = await adapter(u, id, provider);
    const list = await a.tables();
    return { canSql: a.canSql, text: list.slice(0, 25).map((t) => `${t.name}(${(t.columns || []).slice(0, 20)
      .join(', ')})${t.rows == null ? '' : ` ${t.rows} rows`}`).join('\n') || '(no tables yet)' };
  }
  return { run, tables, rows, schema, providers: Object.keys(ADAPTERS) };
}

module.exports = { createRemote, isRead, guard, ADAPTERS };
