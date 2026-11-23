// Workspace data (v0.29.0, Workspace step 5; plan: docs/workspace/plan.md, details: docs/workspace/step-5.md).
// Every workspace gets a safe key store and a small database, so a static site can keep orders, sign-ups or
// messages and call paid APIs without ever shipping a key in its files.
//
//   secrets      NAME = value, encrypted at rest (shared/crypto.js). The value never leaves the server again: the
//                owner sees names only. A page uses one through call(): Colon adds it to a request to the secret's
//                own host (https only, never a private address, no redirects) and masks it in the answer.
//   collections  named tables. read/add rules: 'public' (anyone on the site) or 'owner' (only inside Colon).
//   records      one JSON object each (8 KB max); 5000 per workspace. Changing and deleting is owner-only.
//   site key     a page names its workspace by the workspace id (public API: /sites/:key/...).
const dns = require('dns').promises;
const net = require('net');
const { dataSqlStore } = require('./data-store');

const LIMITS = { secrets: 30, collections: 20, records: 5000, recordBytes: 8192, valueChars: 4000,
  answerBytes: 1048576, timeoutMs: 15000 };
const SECRET = /^[A-Z][A-Z0-9_]{1,63}$/;
const COLLECTION = /^[a-z][a-z0-9_-]{0,47}$/;
const HOST = /^(?=.{3,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SEND_AS = /^(bearer|header:[A-Za-z0-9-]{1,40}|query:[A-Za-z0-9_.-]{1,40})$/;
const RULES = ['public', 'owner'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });

// Loopback, private, link-local, CGNAT and other non-public ranges (IPv4 and IPv6).
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16
      && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const s = ip.toLowerCase();
  if (s.startsWith('::ffff:')) return privateIp(s.slice(7));
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff');
}

const parse = (d) => { try { return JSON.parse(d); } catch { return null; } };
const recOut = (r) => ({ id: Number(r.id), data: parse(r.data), created_at: r.created_at });
const secOut = (s) => ({ name: s.name, host: s.host || null, as: s.send_as, updated_at: s.updated_at });
const colOut = (c) => ({ name: c.name, read: c.read_rule, add: c.add_rule, records: Number(c.records) || 0 });

function createData({ engine, store = dataSqlStore(), box = require('../../shared/crypto'), fetchImpl = fetch,
  lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
  const ws = async (u, id) => (await engine.owned(u, id)).id;
  async function site(key) {
    const s = key && await store.site(key);
    if (!s) throw err(404, 'not_found', 'This site has no Colon data.');
    return s.id;
  }
  function cleanName(re, v, what) {
    const s = String(v == null ? '' : v).trim();
    if (!re.test(s)) throw err(422, 'invalid', `That isn’t a valid ${what} name.`, { field: 'name' });
    return s;
  }

  // ---- owner (inside Colon) ----
  async function overview(u, id) {
    const w = await ws(u, id);
    return { key: w, secrets: (await store.secrets(w)).map(secOut),
      collections: (await store.collections(w)).map(colOut), limits: LIMITS };
  }
  async function putSecret(u, id, name, b = {}) {
    const w = await ws(u, id), n = cleanName(SECRET, name, 'secret');
    const had = await store.secret(w, n);
    const value = b.value == null ? null : String(b.value);
    if (!had && !value) throw err(422, 'invalid', 'Paste the secret’s value.', { field: 'value' });
    if (value !== null && (!value.trim() || value.length > LIMITS.valueChars)) {
      throw err(422, 'invalid', `A secret is 1 to ${LIMITS.valueChars} characters.`, { field: 'value' });
    }
    const host = b.host === undefined && had ? had.host : b.host ? String(b.host).trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    if (host && (!HOST.test(host) || net.isIP(host) || /\.(local|internal|localhost)$/.test(host))) {
      throw err(422, 'invalid', 'Use the API’s host name, like api.example.com.', { field: 'host' });
    }
    const as = String(b.as || (had && had.send_as) || 'bearer');
    if (!SEND_AS.test(as)) throw err(422, 'invalid', 'Choose how the key is sent.', { field: 'as' });
    if (!had && (await store.secrets(w)).length >= LIMITS.secrets) {
      throw err(413, 'too_many', `A workspace can keep up to ${LIMITS.secrets} secrets.`);
    }
    await store.putSecret(w, { name: n, value_enc: value === null ? had.value_enc : box.encrypt(value), host,
      send_as: as });
    return secOut({ name: n, host, send_as: as, updated_at: new Date() });
  }
  async function deleteSecret(u, id, name) {
    if (!await store.deleteSecret(await ws(u, id), String(name))) throw err(404, 'not_found', 'No such secret.');
    return { ok: true };
  }
  async function putCollection(u, id, name, b = {}) {
    const w = await ws(u, id), n = cleanName(COLLECTION, name, 'table');
    const read = RULES.includes(b.read) ? b.read : 'owner', add = RULES.includes(b.add) ? b.add : 'owner';
    if (!await store.collection(w, n) && (await store.collections(w)).length >= LIMITS.collections) {
      throw err(413, 'too_many', `A workspace can have up to ${LIMITS.collections} tables.`);
    }
    await store.putCollection(w, { name: n, read_rule: read, add_rule: add });
    return { name: n, read, add };
  }
  async function deleteCollection(u, id, name) {
    if (!await store.deleteCollection(await ws(u, id), String(name))) throw err(404, 'not_found', 'No such table.');
    return { ok: true };
  }
  async function table(w, name) {
    const c = await store.collection(w, String(name));
    if (!c) throw err(404, 'not_found', `There’s no “${String(name).slice(0, 48)}” table.`);
    return c;
  }
  async function list(w, name, q = {}) {
    await table(w, name);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const rows = (await store.records(w, String(name), Number(q.before) || 0, limit)).map(recOut);
    return { records: rows, next: rows.length === limit ? rows[rows.length - 1].id : null };
  }
  async function insert(w, name, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw err(422, 'invalid', 'A record is one JSON object.', { field: 'data' });
    }
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) > LIMITS.recordBytes) {
      throw err(413, 'too_large', `A record can be up to ${LIMITS.recordBytes / 1024} KB.`);
    }
    if (await store.countRecords(w) >= LIMITS.records) {
      throw err(413, 'full', `This site’s database is full (${LIMITS.records} records).`);
    }
    return { id: await store.addRecord(w, String(name), json) };
  }
  const records = async (u, id, name, q) => list(await ws(u, id), name, q);
  async function addRecord(u, id, name, b = {}) {
    const w = await ws(u, id);
    await table(w, name);
    return insert(w, name, b.data);
  }
  async function deleteRecord(u, id, name, rid) {
    if (!await store.deleteRecord(await ws(u, id), String(name), rid)) {
      throw err(404, 'not_found', 'No such record.');
    }
    return { ok: true };
  }

  // ---- public (a page on the site) ----
  async function publicList(key, name, q) {
    const w = await site(key), c = await table(w, name);
    if (c.read_rule !== 'public') throw err(403, 'private', 'This table is private.');
    return list(w, name, q);
  }
  async function publicAdd(key, name, b = {}) {
    const w = await site(key), c = await table(w, name);
    if (c.add_rule !== 'public') throw err(403, 'private', 'This table doesn’t take new records from the site.');
    return insert(w, name, b.data);
  }
  async function call(key, name, b = {}) {
    const w = await site(key);
    const s = await store.secret(w, String(name));
    if (!s) throw err(404, 'not_found', `There’s no “${String(name).slice(0, 64)}” key.`);
    if (!s.host) throw err(409, 'no_host', 'This key has no API host set.');
    const method = String(b.method || 'GET').toUpperCase();
    if (!METHODS.includes(method)) throw err(422, 'invalid', 'Use GET, POST, PUT, PATCH or DELETE.');
    const p = String(b.path || '/');
    if (!p.startsWith('/') || p.startsWith('//') || /\s/.test(p)) throw err(422, 'invalid', 'Start the path with /.');
    const url = new URL(`https://${s.host}${p}`);
    if (url.hostname !== s.host) throw err(422, 'invalid', 'The path can’t change the host.');
    for (const [k, v] of Object.entries(b.query && typeof b.query === 'object' ? b.query : {})) {
      url.searchParams.set(k, String(v));
    }
    const addrs = await lookup(s.host).catch(() => []);
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) {
      throw err(422, 'bad_host', 'Colon only calls public APIs.');
    }
    const value = box.decrypt(s.value_enc);
    const headers = { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'ColonSites/1' };
    if (s.send_as === 'bearer') headers.authorization = `Bearer ${value}`;
    else if (s.send_as.startsWith('header:')) headers[s.send_as.slice(7).toLowerCase()] = value;
    else url.searchParams.set(s.send_as.slice(6), value);
    let body;
    if (b.body !== undefined && method !== 'GET') {
      body = typeof b.body === 'string' ? b.body : JSON.stringify(b.body);
      headers['content-type'] = typeof b.body === 'string' ? 'text/plain' : 'application/json';
    }
    let r;
    try {
      r = await fetchImpl(url, { method, headers, body, redirect: 'error',
        signal: AbortSignal.timeout(LIMITS.timeoutMs) });
    } catch (e) {
      throw err(502, 'upstream', `${s.host} didn’t answer.`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > LIMITS.answerBytes) throw err(502, 'too_large', 'The API’s answer is too large.');
    const text = buf.toString('utf8').split(value).join('••••');
    const data = /json/i.test(r.headers.get('content-type') || '') ? parse(text) ?? text : text;
    return { status: r.status, ok: r.ok, data };
  }

  return { overview, putSecret, deleteSecret, putCollection, deleteCollection, records, addRecord, deleteRecord,
    publicList, publicAdd, call, LIMITS };
}

module.exports = { createData, privateIp, LIMITS };
