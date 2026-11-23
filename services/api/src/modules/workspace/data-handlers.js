// Workspace data handlers (v0.29.0, Workspace step 5; routes: src/http/routes/workspace.js and sites.js).
// Owner routes act on req.user's own workspace; the /sites routes are public, called by a published page (any
// origin, no cookies, no session read), and limited per IP.
const audit = (...a) => require('../../shared/audit')(...a);   // lazy: tests load this without mysql2
const { SECURITY_HEADERS } = require('../../shared/security-headers');
const { sdk } = require('./sdk');

let shared = null, deps = null;
const data = () => shared || (shared = require('./data').createData({ engine: require('./index').instance(),
  ...(deps || {}) }));
const setDataDeps = (d) => { deps = d; shared = null; };
const qobj = (req) => ({ limit: req.query && req.query.get ? req.query.get('limit') : null,
  before: req.query && req.query.get ? req.query.get('before') : null });
const OPEN = { 'Cross-Origin-Resource-Policy': 'cross-origin' };
const p = (req) => req.params;
const apiUrl = () => { try { return require('../../config').payments.apiUrl; } catch { return ''; } };
// What the Workspace chat tells the model about the site's data (chat.js -> prompt.js).
const info = async (u, id) => ({ ...(await data().overview(u, id)),
  api: apiUrl() || 'https://api.apparatus.name.ng' });

// ---- owner ----
// GET /workspaces/:id/data -> { key, api, secrets[] (names only), collections[], limits }
const getData = async (req) => [200, await info(req.user, p(req).id)];
// PUT /workspaces/:id/secrets/:name { value?, host?, as? } -> secret (never the value)
const putSecret = async (req) => {
  const out = await data().putSecret(req.user, p(req).id, p(req).name, req.body || {});
  await audit(req, 'workspace.secret_saved', { actorId: req.user.id, targetType: 'workspace',
    targetId: String(p(req).id), meta: { name: out.name, host: out.host } });
  return [200, out];
};
const deleteSecret = async (req) => {
  const out = await data().deleteSecret(req.user, p(req).id, p(req).name);
  await audit(req, 'workspace.secret_deleted', { actorId: req.user.id, targetType: 'workspace',
    targetId: String(p(req).id), meta: { name: String(p(req).name) } });
  return [200, out];
};
// PUT /workspaces/:id/tables/:name { read, add } -> table
const putTable = async (req) => [200, await data().putCollection(req.user, p(req).id, p(req).name, req.body || {})];
const deleteTable = async (req) => [200, await data().deleteCollection(req.user, p(req).id, p(req).name)];
// GET /workspaces/:id/tables/:name/records?limit&before -> { records[], next }
const getRecords = async (req) => [200, await data().records(req.user, p(req).id, p(req).name, qobj(req))];
const postRecord = async (req) => [201, await data().addRecord(req.user, p(req).id, p(req).name, req.body || {})];
const deleteRecord = async (req) => [200, await data().deleteRecord(req.user, p(req).id, p(req).name, p(req).rid)];

// ---- public: a page on the site ----
// GET /sites/:key/colon.js -> the site script (sdk.js)
const getScript = async (req, res) => {
  res.writeHead(200, { ...SECURITY_HEADERS, ...OPEN, 'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=300' });
  res.end(sdk(p(req).key));
};
const siteList = async (req) => [200, await data().publicList(p(req).key, p(req).name, qobj(req)), OPEN];
const siteAdd = async (req) => [201, await data().publicAdd(p(req).key, p(req).name, req.body || {}), OPEN];
const siteCall = async (req) => [200, await data().call(p(req).key, p(req).name, req.body || {}), OPEN];

module.exports = { getData, putSecret, deleteSecret, putTable, deleteTable, getRecords, postRecord, deleteRecord,
  getScript, siteList, siteAdd, siteCall, setDataDeps, info };
