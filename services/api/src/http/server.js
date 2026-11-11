const http = require('http');
const config = require('../config');
const log = require('../lib/logger');
const ws = require('../ws');

const routes = { ...require('./routes/health') };

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
}

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const path = new URL(req.url, 'http://local').pathname.replace(/\/+$/, '') || '/';
  const handler = routes[`${req.method} ${path}`];
  if (!handler) return json(res, 404, { error: 'not_found' });
  try {
    const [code, body] = await handler(req);
    json(res, code, body);
  } catch (e) {
    log.error('request_failed', { path, err: e.message });
    json(res, 500, { error: 'server_error' });
  }
});

ws.attach(server);

server.listen(config.port, () => log.info('api_listening', { port: config.port }));

module.exports = server;
