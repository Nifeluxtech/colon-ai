const LANGS = ['en', 'pcm', 'yo', 'ha', 'ig'];

const fail = (field, message) => { throw Object.assign(new Error(message), { status: 422, code: 'invalid', field }); };

module.exports = {
  LANGS,
  email(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail('email', 'Enter a valid email address.');
    return s;
  },
  password(v, field = 'password') {
    const s = String(v || '');
    if (s.length < 10) fail(field, 'Use at least 10 characters.');
    if (s.length > 200) fail(field, 'That password is too long.');
    if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) fail(field, 'Mix letters and numbers.');
    return s;
  },
  name(v) {
    const s = String(v || '').trim().replace(/\s+/g, ' ');
    if (s.length < 1 || s.length > 80) fail('name', 'Enter your name (up to 80 characters).');
    return s;
  },
  language(v) {
    const s = String(v || 'en');
    if (!LANGS.includes(s)) fail('language', 'Choose a supported language.');
    return s;
  },
  fail,
};
