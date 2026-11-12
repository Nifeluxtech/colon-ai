// RFC 6238 TOTP (Google Authenticator, Authy, Microsoft Authenticator). No dependencies.
const crypto = require('crypto');
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHA.indexOf(ch); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32Encode(crypto.randomBytes(20));

function code(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// Accepts the current 30 s step and one step either side (clock drift).
function verify(secret, token) {
  const t = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some(d => crypto.timingSafeEqual(Buffer.from(code(secret, step + d)), Buffer.from(t)));
}

const otpauthUrl = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { newSecret, verify, otpauthUrl, code };
