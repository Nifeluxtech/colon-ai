// Minimal structured logger (JSON lines -> cPanel stderr.log / stdout).
const write = (level, msg, meta = {}) =>
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }));

module.exports = {
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
};
