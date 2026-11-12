// Helpers shared by the admin-platform handlers.
const v = require('../../../shared/validate');

const url = (s, field) => {
  s = String(s || '').trim();
  if (s && (!/^https?:\/\/\S+$/i.test(s) || s.length > 500)) v.fail(field, 'Use a full http(s):// link.');
  return s;
};

module.exports = { url };
