const http = require('http');
const config = require('../config');
const db = require('../db');
const log = require('../lib/logger');
const ws = require('../ws');
const sessions = require('../auth/sessions');
const Router = require('./router');
const { clientIp, parseCookies, readJson } = require('./request');

const router = new Router()
  .use(require('./routes/health'))
  .use(require('./routes/auth'))
  .use(require('./routes/account'))
  .use(require('./routes/admin'))
  .use(require('./routes/chat'))
  .use(require('./routes/uploads'));

const { SECURITY_HEADERS } = require('./headers');

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

const server = http.createServer(async (req, res) => {
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
});

ws.attach(server);

db.migrate().catch(e => log.error('migrate_failed', { err: e.message }));
server.listen(config.port, () => log.info('api_listening', { port: config.port }));

module.exports = server;
