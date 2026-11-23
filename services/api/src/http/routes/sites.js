// Public site routes (v0.29.0, Workspace step 5): what a published page (apparatus.name.ng/<name>/) or the
// Workspace preview calls through colon.js. Any origin, no cookies (server.js answers CORS with "*" for /sites/),
// no CSRF header (csrf: false), limited per IP. Handlers: modules/workspace/data-handlers.js.
const Router = require('../router');
const { limit } = require('../middleware/ratelimit');
const d = require('../../modules/workspace').dataHandlers;

const PUBLIC = { csrf: false };
module.exports = new Router()
  .get('/sites/:key/colon.js', PUBLIC, d.getScript)
  .get('/sites/:key/data/:name', PUBLIC, limit('site-read', 600, 3600), d.siteList)
  .post('/sites/:key/data/:name', PUBLIC, { bodyLimit: 16384 }, limit('site-add', 60, 3600), d.siteAdd)
  .post('/sites/:key/call/:name', PUBLIC, { bodyLimit: 65536 }, limit('site-call', 120, 3600), d.siteCall);
