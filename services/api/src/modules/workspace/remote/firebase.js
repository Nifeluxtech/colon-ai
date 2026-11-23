// Firebase (Cloud Firestore) with server access (v0.31.0): the service account signs an RS256 JWT (node:crypto,
// no SDK), swapped at oauth2.googleapis.com for an access token, then the Firestore REST API. Tables are top-level
// collections, rows documents (Firestore's typed values are turned into plain JSON and back). Collections appear
// when their first document is added, so createTable only checks the name.
const crypto = require('crypto');
const { must } = require('./http');
const { SCAN, name, match, cap } = require('./common');

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(o) { const f = {}; for (const [k, v] of Object.entries(o || {})) f[k] = toValue(v); return f; }
function fromValue(v) {
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields);
  return v.stringValue ?? v.timestampValue ?? v.referenceValue ?? v.bytesValue
    ?? (v.geoPointValue ? JSON.stringify(v.geoPointValue) : null);
}
function fromFields(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) o[k] = fromValue(v); return o; }

function firebase({ secret }, http, now = () => Math.floor(Date.now() / 1000)) {
  const sa = JSON.parse(secret.serviceAccount), label = 'Firebase';
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/databases/(default)`
    + '/documents';
  let token = null, until = 0;
  async function auth() {
    if (token && now() < until - 60) return token;
    const t = now(), head = b64({ alg: 'RS256', typ: 'JWT' });
    const claim = b64({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: t,
      exp: t + 3600 });
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claim}`), sa.private_key).toString('base64url');
    const r = await http.call('https://oauth2.googleapis.com/token', { method: 'POST', label,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}`
        + `&assertion=${head}.${claim}.${sig}` });
    const d = must(r, label);
    token = d.access_token; until = t + (Number(d.expires_in) || 3600);
    return token;
  }
  const api = async (path, o = {}) => must(await http.call(`${base}${path}`, { ...o, label,
    headers: { authorization: `Bearer ${await auth()}` } }), label);
  const docOut = (d) => ({ id: String(d.name).split('/').pop(), ...fromFields(d.fields) });
  async function tables() {
    const d = await api(':listCollectionIds', { method: 'POST', json: { pageSize: 100 } });
    return (d.collectionIds || []).map((n) => ({ name: n, columns: [], rows: null }));
  }
  async function all(t) {
    const d = await api(`/${encodeURIComponent(name(t))}?pageSize=${Math.min(SCAN, 300)}`);
    return (d.documents || []).map(docOut);
  }
  async function rows(t, o = {}) {
    const list = (await all(t)).filter((r) => match(r, o.where)).slice(0, cap(o.limit));
    return { rows: list, columns: [...new Set(list.flatMap((r) => Object.keys(r)))] };
  }
  async function insert(t, list) {
    const out = [];
    for (const row of [].concat(list).slice(0, 100)) {
      out.push(docOut(await api(`/${encodeURIComponent(name(t))}`, { method: 'POST',
        json: { fields: toFields(row) } })));
    }
    return { inserted: out.length, rows: out.slice(0, 20) };
  }
  async function update(t, where, values) {
    const hit = (await all(t)).filter((r) => match(r, where)).slice(0, 100);
    const mask = Object.keys(values || {}).map((k) => `updateMask.fieldPaths=${encodeURIComponent(name(k, 'field'))}`)
      .join('&');
    for (const r of hit) {
      await api(`/${encodeURIComponent(name(t))}/${encodeURIComponent(r.id)}?${mask}`, { method: 'PATCH',
        json: { fields: toFields(values) } });
    }
    return { updated: hit.length };
  }
  async function remove(t, where) {
    const hit = (await all(t)).filter((r) => match(r, where)).slice(0, 100);
    for (const r of hit) await api(`/${encodeURIComponent(name(t))}/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    return { deleted: hit.length };
  }
  const createTable = async (t) => ({ created: name(t), note: 'Firestore creates it with the first document.' });
  const addColumn = async (t, c) => ({ added: name(c.name, 'field'), note: 'Firestore fields need no schema.' });
  return { label, canSql: false, tables, rows, insert, update, remove, createTable, addColumn };
}

module.exports = { firebase, toFields, fromFields };
