// WebSocket gateway. Host workers can be recycled at any time, so clients must
// auto-reconnect and no session state may live only in memory (persist to MySQL).
// Phase 8: the socket is tied to the signed-in user (the colon_sid cookie, loaded like the HTTP routes do) and
// each socket gets a browser bridge (modules/browser/bridge.js): hello with `session: 1`, session_sync,
// session_request and the control-owner rules. Signed-out sockets keep the plain hello / ping-pong.
const { WebSocketServer } = require('ws');
const config = require('../config');
const audit = require('../shared/audit');
const log = require('../shared/logger');
const { sessions } = require('../modules/auth');
const browser = require('../modules/browser');
const { clientIp, parseCookies } = require('../http/middleware/request');

const HARD_MAX_PAYLOAD = 1024 * 1024;   // above this ws closes the socket; 64 KB+ frames get an error reply instead

async function authenticate(req) {
  req.ip = clientIp(req);
  req.cookies = parseCookies(req.headers.cookie);
  return sessions.load(req).catch(() => null);
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: HARD_MAX_PAYLOAD });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://local').pathname;
    const origin = req.headers.origin;
    if (path !== '/ws' || (origin && !config.allowedOrigins.includes(origin))) return socket.destroy();
    authenticate(req).then((user) => {
      req.user = user;
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    }, () => socket.destroy());
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const bridge = browser.bridge.createBridge({
      send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
      user: req && req.user, req: req || {}, audit,
    });
    ws.send(JSON.stringify({ type: 'hello', service: 'colon-ai', ts: Date.now() }));
    ws.on('message', data => {
      bridge.handle(data).catch(e => log.warn('ws_frame_failed', { err: e.message, code: e.code }));
    });
    ws.on('close', () => bridge.close());
  });

  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000).unref();

  return wss;
}

module.exports = { attach };
