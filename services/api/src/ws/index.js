// WebSocket gateway. Host workers can be recycled at any time, so clients must
// auto-reconnect and no session state may live only in memory (persist to MySQL).
const { WebSocketServer } = require('ws');
const config = require('../config');

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://local').pathname;
    const origin = req.headers.origin;
    if (path !== '/ws' || (origin && !config.allowedOrigins.includes(origin))) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: 'hello', service: 'colon-ai', ts: Date.now() }));
    ws.on('message', data => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    });
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
