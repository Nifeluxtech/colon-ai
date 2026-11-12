// Provider errors carry .code: 'blocked' (captcha / anomaly page / 403 / 429), 'auth', 'http_<status>',
// 'timeout', 'network', 'parse'.
const err = (code, message) => Object.assign(new Error(message || code), { code });

module.exports = { err };
