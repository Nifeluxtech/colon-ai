const http = require('http');
const config = require('../config');
const requestContext = require('../shared/request-context');

// Refuse to start on a missing required setting or a malformed value, with a clear message in stderr.log.
try { config.assertValid(); } catch (e) { console.error(e.message); process.exit(1); }
const db = require('../db');
const log = require('../shared/logger');
const ws = require('../ws');
const sessions = require('../modules/auth').sessions;
const { clientIp, parseCookies, readJson } = require('./middleware/request');

const router = require('./routes');

const { SECURITY_HEADERS } = require('./middleware/headers');
const settings = require('../shared/settings');

// Maintenance mode (Phase 4): new chat activity gets 503 with the admin's message. Reading history,
// settings and sign-in keep working, and staff are exempt so they can test the fix.
const CHAT_WRITE = new RegExp(String.raw`^/(chat/guest(/extract)?|study/cbt|conversations(/.*)?|`
  + String.raw`messages/[^/]+/feedback|uploads(/.*)?)$`);
async function maintenance(req, path) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !CHAT_WRITE.test(path)) return null;
  if (req.user && settings.STAFF.has(req.user.role)) return null;
  const sys = await settings.system();
  return sys.maintenance.on ? { error: 'maintenance', message: sys.maintenance.message
    || settings.SYSTEM_DEFAULT.maintenance.message } : null;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Colon-Client');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

// CSRF: state-changing requests must come from an allowed origin AND carry the custom
// X-Colon-Client header (which forces a CORS preflight that other sites can't pass).
function csrfOk(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) return false;
  return Boolean(req.headers['x-colon-client']);
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const requestId = requestContext.requestIdFor(req.headers['x-request-id']);
  res.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, () => handle(req, res));
});

async function handle(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204, SECURITY_HEADERS); return res.end(); }
  const url = new URL(req.url, 'http://local');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    const match = router.match(req.method, path);
    if (!match) return send(res, 404, { error: 'not_found' });
    if (match.methodNotAllowed) return send(res, 405, { error: 'method_not_allowed' });
    if (!csrfOk(req)) return send(res, 403, { error: 'csrf', message: 'Request blocked.' });
    req.ip = clientIp(req);
    req.query = url.searchParams;
    req.params = match.params;
    req.cookies = parseCookies(req.headers.cookie);
    req.body = match.opts.body === 'raw' ? {} : await readJson(req, match.opts.bodyLimit);
    req.user = path === '/health' || path === '/' ? null : await sessions.load(req).catch(() => null);
    const down = await maintenance(req, path);
    if (down) return send(res, 503, down, { 'Retry-After': '300' });
    let result;
    for (const h of match.handlers) { result = await h(req, res); }
    if (res.headersSent || res.writableEnded) return; // the handler streamed or sent a file itself
    const [code, body, headers] = result;
    send(res, code, body, headers);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log.error('request_failed', { path, err: e.message, code: e.code });
    if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
    send(res, status, {
      error: e.code || 'server_error',
      message: status >= 500 && !e.code ? 'Something went wrong. Please try again.' : e.message,
      field: e.field,
    });
  }
}

ws.attach(server);

db.migrate().catch(e => log.error('migrate_failed', { err: e.message }));
server.listen(config.port, () => log.info('api_listening', { port: config.port }));

module.exports = server;
