// Minimal structured logger (JSON lines). warn/error go to stderr, which cPanel/Passenger keeps in stderr.log.
// Lines written while handling a request carry its id (req_id, also sent as the X-Request-Id header).
const context = require('./request-context');

const write = (level, msg, meta = {}) => {
  const ctx = context.current();
  const line = { t: new Date().toISOString(), level, msg, ...(ctx ? { req_id: ctx.requestId } : {}), ...meta };
  console[level === 'info' ? 'log' : 'error'](JSON.stringify(line));
};

module.exports = {
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
};
