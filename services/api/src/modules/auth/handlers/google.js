// Auth: Google sign-in (handlers for src/http/routes/auth/google.js).

const db = require('../../../db');
const config = require('../../../config');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const totp = require('../totp');
const { decrypt } = require('../../../shared/crypto');
const sessions = require('../sessions');
const settings = require('../../../shared/settings');
const { roleFor, blockSuspended } = require('./auth-common');

// Google sign-in: the app sends the ID token from Google Identity Services; Google verifies it.
// POST /auth/google
const postAuthGoogle = async (req) => {
  if (!config.auth.googleClientId) v.fail('google', 'Google sign-in is not set up yet.');
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(req.body.credential || ''))}`);
  const g = res.ok ? await res.json() : null;
  if (!g || g.aud !== config.auth.googleClientId || g.email_verified !== 'true' || !g.sub) v.fail('google', 'Google sign-in failed. Please try again.');
  const email = v.email(g.email);
  let u = await db.one('SELECT id, totp_enabled, totp_secret FROM users WHERE google_sub = ? OR email = ? ORDER BY google_sub = ? DESC LIMIT 1', [g.sub, email, g.sub]);
  if (!u) {
    if ((await settings.system()).features.registration === false) v.fail('google', 'New sign-ups are paused right now. Please try again later.');
    const result = await db.query(
      'INSERT INTO users (email, email_verified_at, name, google_sub, role) VALUES (?, UTC_TIMESTAMP(), ?, ?, ?)',
      [email, String(g.name || email.split('@')[0]).slice(0, 80), g.sub, roleFor(email)]
    );
    u = { id: result.insertId, totp_enabled: 0 };
    await audit(req, 'user.register_google', { actorId: u.id, targetType: 'user', targetId: u.id });
  } else {
    await db.query('UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?', [g.sub, u.id]);
  }
  await blockSuspended(req, u.id);
  if (u.totp_enabled) {
    if (!req.body.code) return [200, { need_totp: true }];
    if (!totp.verify(decrypt(u.totp_secret), req.body.code)) v.fail('code', "That code didn't work.");
  }
  await audit(req, 'auth.login_google', { actorId: u.id });
  return [200, { ok: true }, { 'Set-Cookie': await sessions.create(req, u.id) }];
};

module.exports = { postAuthGoogle };
