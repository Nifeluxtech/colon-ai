// PocketBase with server access (v0.31.0): the superuser login (PocketBase 0.23+ _superusers, or the older
// /api/admins) gets a token for the collections and records APIs. Tables are collections; "columns" are fields.
const { must } = require('./http');
const { SCAN, name, match, cap } = require('./common');

const TYPES = { text: 'text', string: 'text', number: 'number', integer: 'number', float: 'number', boolean: 'bool',
  bool: 'bool', date: 'date', email: 'email', url: 'url', json: 'json' };

function pocketbase({ config, secret }, http) {
  const base = String(config.url || '').replace(/\/+$/, ''), label = 'PocketBase';
  let token = null;
  async function auth() {
    if (token) return token;
    const body = { identity: secret.email, password: secret.password };
    let r = await http.call(`${base}/api/collections/_superusers/auth-with-password`, { method: 'POST', json: body,
      label });
    if (r.status === 404) r = await http.call(`${base}/api/admins/auth-with-password`, { method: 'POST', json: body,
      label });
    token = must(r, label).token;
    return token;
  }
  const api = async (path, o = {}) => must(await http.call(`${base}/api/${path}`, { ...o, label,
    headers: { authorization: await auth() } }), label);
  const fieldsOf = (c) => (c.fields || c.schema || []).map((f) => f.name).filter((n) => n && !/^(password|tokenKey)$/
    .test(n));
  async function tables() {
    const d = await api('collections?perPage=200');
    const list = (d.items || []).filter((c) => !c.system && !/^_/.test(c.name));
    return list.map((c) => ({ name: c.name, columns: ['id', ...fieldsOf(c)], rows: null }));
  }
  async function all(table, n = SCAN) {
    const d = await api(`collections/${name(table)}/records?perPage=${Math.min(n, 500)}&sort=-created`);
    return d.items || [];
  }
  async function rows(table, o = {}) {
    const list = (await all(table)).filter((r) => match(r, o.where)).slice(0, cap(o.limit));
    return { rows: list };
  }
  async function insert(table, list) {
    const out = [];
    for (const row of [].concat(list).slice(0, 100)) {
      out.push(await api(`collections/${name(table)}/records`, { method: 'POST', json: row }));
    }
    return { inserted: out.length, rows: out.slice(0, 20) };
  }
  async function update(table, where, values) {
    const hit = (await all(table)).filter((r) => match(r, where)).slice(0, 100);
    for (const r of hit) await api(`collections/${name(table)}/records/${r.id}`, { method: 'PATCH', json: values });
    return { updated: hit.length };
  }
  async function remove(table, where) {
    const hit = (await all(table)).filter((r) => match(r, where)).slice(0, 100);
    for (const r of hit) await api(`collections/${name(table)}/records/${r.id}`, { method: 'DELETE' });
    return { deleted: hit.length };
  }
  const field = (c) => ({ name: name(c.name, 'column'), type: TYPES[String(c.type || 'text').toLowerCase()] || 'text',
    required: Boolean(c.required) });
  async function createTable(table, columns = []) {
    const fields = columns.filter((c) => c.name !== 'id').map(field);
    await api('collections', { method: 'POST', json: { name: name(table), type: 'base', fields, schema: fields,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null } });
    return { created: table };
  }
  async function addColumn(table, c) {
    const col = (await api(`collections/${name(table)}`));
    const key = col.fields ? 'fields' : 'schema';
    await api(`collections/${name(table)}`, { method: 'PATCH', json: { [key]: [...(col[key] || []), field(c)] } });
    return { added: c.name };
  }
  return { label, canSql: false, tables, rows, insert, update, remove, createTable, addColumn };
}

module.exports = { pocketbase };
