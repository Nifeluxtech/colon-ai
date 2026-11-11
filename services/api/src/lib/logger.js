// Minimal structured logger (JSON lines). warn/error go to stderr, which cPanel/Passenger keeps in stderr.log.
const write = (level, msg, meta = {}) =>
  console[level === 'info' ? 'log' : 'error'](JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }));

module.exports = {
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
};
