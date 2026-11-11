const crypto = require('crypto');
const { auth } = require('../config');

// Passwords: scrypt (built into Node, no native build needed on cPanel).
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (!stored || !stored.startsWith('scrypt$')) return resolve(false);
    const [, N, r, p, saltB64, keyB64] = stored.split('$');
    const expected = Buffer.from(keyB64, 'base64');
    crypto.scrypt(password, Buffer.from(saltB64, 'base64'), expected.length,
      { N: Number(N), r: Number(r), p: Number(p) }, (err, key) => {
        if (err) return resolve(false);
        resolve(crypto.timingSafeEqual(key, expected));
      });
  });
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// AES-256-GCM for secrets at rest (2FA seeds). Key derived from APP_SECRET.
function key() {
  if (!auth.appSecret || auth.appSecret.length < 32) {
    throw Object.assign(new Error('APP_SECRET missing'), { status: 503, code: 'app_secret_missing' });
  }
  return crypto.createHash('sha256').update(auth.appSecret).digest();
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
function decrypt(box) {
  const [v, iv, tag, data] = String(box).split('.');
  if (v !== 'v1') throw new Error('bad box');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

module.exports = { hashPassword, verifyPassword, randomToken, sha256, encrypt, decrypt };
