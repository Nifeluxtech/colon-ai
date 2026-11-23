// Appwrite with server access (v0.31.0): a server API key (X-Appwrite-Key) on the Databases API. Tables are the
// collections of one database (the connection's Database ID, or the project's first database). Rows are documents.
const { must } = require('./http');
const { SCAN, name, match, cap } = require('./common');

const KINDS = { text: 'string', string: 'string', integer: 'integer', number: 'float', float: 'float',
  boolean: 'boolean', bool: 'boolean', email: 'email', url: 'url', date: 'datetime', datetime: 'datetime' };
const q = (method, values, attribute) => encodeURIComponent(JSON.stringify({ method, ...(attribute ? { attribute }
  : {}), values }));

function appwrite({ config, secret }, http) {
  const base = String(config.endpoint || '').replace(/\/+$/, ''), label = 'Appwrite';
  const headers = { 'x-appwrite-project': config.projectId, 'x-appwrite-key': secret.apiKey };
  const api = async (path, o = {}) => must(await http.call(`${base}/${path}`, { ...o, headers, label }), label);
  let db = config.databaseId || null;
  async function database() {
    if (db) return db;
    const d = await api('databases');
    if (!(d.databases || []).length) {
      db = (await api('databases', { method: 'POST', json: { databaseId: 'unique()', name: 'Site' } })).$id;
    } else db = d.databases[0].$id;
    return db;
  }
  const col = async (t) => `databases/${await database()}/collections/${encodeURIComponent(name(t))}`;
  // a table name the model gives may be the collection's name or its id
  async function idOf(t) {
    const d = await api(`databases/${await database()}/collections?queries[]=${q('limit', [100])}`);
    const hit = (d.collections || []).find((c) => c.$id === t || c.name === t);
    return hit ? hit.$id : t;
  }
  const plain = (doc) => {
    const o = { id: doc.$id };
    for (const [k, v] of Object.entries(doc)) if (k[0] !== '$') o[k] = v;
    return o;
  };
  async function tables() {
    const d = await api(`databases/${await database()}/collections?queries[]=${q('limit', [100])}`);
    return (d.collections || []).map((c) => ({ name: c.name || c.$id, id: c.$id, rows: null,
      columns: ['id', ...(c.attributes || []).map((a) => a.key)] }));
  }
  async function all(t) {
    const d = await api(`${await col(await idOf(t))}/documents?queries[]=${q('limit', [Math.min(SCAN, 500)])}`
      + `&queries[]=${q('orderDesc', [], '$createdAt')}`);
    return (d.documents || []).map(plain);
  }
  async function rows(t, o = {}) {
    return { rows: (await all(t)).filter((r) => match(r, o.where)).slice(0, cap(o.limit)) };
  }
  async function insert(t, list) {
    const out = [], c = await col(await idOf(t));
    for (const data of [].concat(list).slice(0, 100)) {
      out.push(plain(await api(`${c}/documents`, { method: 'POST', json: { documentId: 'unique()', data } })));
    }
    return { inserted: out.length, rows: out.slice(0, 20) };
  }
  async function update(t, where, values) {
    const c = await col(await idOf(t)), hit = (await all(t)).filter((r) => match(r, where)).slice(0, 100);
    for (const r of hit) {
      await api(`${c}/documents/${encodeURIComponent(r.id)}`, { method: 'PATCH', json: { data: values } });
    }
    return { updated: hit.length };
  }
  async function remove(t, where) {
    const c = await col(await idOf(t)), hit = (await all(t)).filter((r) => match(r, where)).slice(0, 100);
    for (const r of hit) await api(`${c}/documents/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    return { deleted: hit.length };
  }
  async function addColumn(t, c) {
    const kind = KINDS[String(c.type || 'text').toLowerCase()] || 'string';
    const body = { key: name(c.name, 'column'), required: Boolean(c.required), ...(kind === 'string' ? { size: 2000 }
      : {}) };
    await api(`${await col(await idOf(t))}/attributes/${kind}`, { method: 'POST', json: body });
    return { added: c.name };
  }
  async function createTable(t, columns = []) {
    const made = await api(`databases/${await database()}/collections`, { method: 'POST',
      json: { collectionId: 'unique()', name: name(t), documentSecurity: false } });
    for (const c of columns.filter((x) => x.name !== 'id').slice(0, 30)) await addColumn(made.$id, c);
    return { created: t };
  }
  return { label, canSql: false, tables, rows, insert, update, remove, createTable, addColumn };
}

module.exports = { appwrite };
