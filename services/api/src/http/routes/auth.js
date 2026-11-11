const Router = require('../router');
const db = require('../../db');
const config = require('../../config');
const v = require('../../lib/validate');
const audit = require('../../lib/audit');
const mailer = require('../../lib/mailer');
const totp = require('../../lib/totp');
const { hashPassword, verifyPassword, randomToken, sha256, decrypt } = require('../../lib/crypto');
const sessions = require('../../auth/sessions');
const { requireUser, publicUser } = require('../../auth/guards');
const { limit, hit } = require('../ratelimit');

const r = new Router();
const LOCK_AFTER = 5;        // failed passwords
const LOCK_MINUTES = 15;

async function issueEmailToken(userId, purpose, hours) {
  const token = randomToken(32);
  await db.query('UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [userId, purpose]);
  await db.query(
    'INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (?,?,?, UTC_TIMESTAMP() + INTERVAL ? HOUR)',
    [userId, purpose, sha256(token), hours]
  );
  return token;
}

async function consumeEmailToken(token, purpose) {
  const row = await db.one(
    `SELECT id, user_id FROM email_tokens
      WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
    [sha256(String(token || '')), purpose]
  );
  if (!row) v.fail('token', 'This link has expired or was already used.');
  await db.query('UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
  return row.user_id;
}

const roleFor = (email) => (config.auth.ownerEmail && email === config.auth.ownerEmail ? 'super_admin' : 'user');

async function sendVerification(user) {
  const token = await issueEmailToken(user.id, 'verify', 24);
  return mailer.verifyEmail(user.email, `${config.urls.chat}/#/verify?token=${token}`);
}

// Public settings the apps need before sign-in.
r.get('/auth/config', async () => [200, {
  google_client_id: config.auth.googleClientId || null,
  email_enabled: Boolean(config.mail.brevoKey),
  languages: v.LANGS,
}]);

r.get('/auth/me', async (req) => [200, { user: req.user ? publicUser(req.user) : null }]);

r.post('/auth/register', limit('register', 10, 3600), async (req) => {
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  const name = v.name(req.body.name);
  const language = v.language(req.body.language);
  if (req.body.accept_terms !== true) v.fail('accept_terms', 'Please accept the terms and privacy policy.');
  if (await db.one('SELECT id FROM users WHERE email = ?', [email])) v.fail('email', 'An account with this email already exists. Try signing in.');
  const result = await db.query(
    'INSERT INTO users (email, password_hash, name, language, role) VALUES (?,?,?,?,?)',
    [email, await hashPassword(password), name, language, roleFor(email)]
  );
  const user = { id: result.insertId, email };
  await audit(req, 'user.register', { actorId: user.id, targetType: 'user', targetId: user.id });
  const mailed = await sendVerification(user);
  const cookie = await sessions.create(req, user.id);
  return [201, { ok: true, verification_sent: mailed }, { 'Set-Cookie': cookie }];
});

r.post('/auth/login', limit('login', 30, 900), async (req) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  await hit(`login-account:${email}`, 20, 900);
  const generic = () => v.fail('password', 'Email or password is incorrect.');
  const u = await db.one('SELECT id, password_hash, totp_enabled, totp_secret, locked_until FROM users WHERE email = ?', [email]);
  if (!u) { await verifyPassword(password, null); generic(); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw Object.assign(new Error(`Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.`), { status: 423, code: 'locked' });
  }
  if (!(await verifyPassword(password, u.password_hash))) {
    await db.query(
      // MySQL applies SET left to right, so failed_logins is already incremented below.
      `UPDATE users SET failed_logins = failed_logins + 1,
         locked_until = IF(failed_logins >= ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE, locked_until) WHERE id = ?`,
      [LOCK_AFTER, LOCK_MINUTES, u.id]
    );
    await audit(req, 'auth.login_failed', { targetType: 'user', targetId: u.id });
    generic();
  }
  if (u.totp_enabled) {
    if (!req.body.code) return [200, { need_totp: true }];
    if (!totp.verify(decrypt(u.totp_secret), req.body.code)) {
      await audit(req, 'auth.totp_failed', { targetType: 'user', targetId: u.id });
      v.fail('code', "That code didn't work. Check your authenticator app and try again.");
    }
  }
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [u.id]);
  await audit(req, 'auth.login', { actorId: u.id });
  return [200, { ok: true }, { 'Set-Cookie': await sessions.create(req, u.id) }];
});

// Google sign-in: the app sends the ID token from Google Identity Services; Google verifies it.
r.post('/auth/google', limit('google', 30, 900), async (req) => {
  if (!config.auth.googleClientId) v.fail('google', 'Google sign-in is not set up yet.');
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(req.body.credential || ''))}`);
  const g = res.ok ? await res.json() : null;
  if (!g || g.aud !== config.auth.googleClientId || g.email_verified !== 'true' || !g.sub) v.fail('google', 'Google sign-in failed. Please try again.');
  const email = v.email(g.email);
  let u = await db.one('SELECT id, totp_enabled, totp_secret FROM users WHERE google_sub = ? OR email = ? ORDER BY google_sub = ? DESC LIMIT 1', [g.sub, email, g.sub]);
  if (!u) {
    const result = await db.query(
      'INSERT INTO users (email, email_verified_at, name, google_sub, role) VALUES (?, UTC_TIMESTAMP(), ?, ?, ?)',
      [email, String(g.name || email.split('@')[0]).slice(0, 80), g.sub, roleFor(email)]
    );
    u = { id: result.insertId, totp_enabled: 0 };
    await audit(req, 'user.register_google', { actorId: u.id, targetType: 'user', targetId: u.id });
  } else {
    await db.query('UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?', [g.sub, u.id]);
  }
  if (u.totp_enabled) {
    if (!req.body.code) return [200, { need_totp: true }];
    if (!totp.verify(decrypt(u.totp_secret), req.body.code)) v.fail('code', "That code didn't work.");
  }
  await audit(req, 'auth.login_google', { actorId: u.id });
  return [200, { ok: true }, { 'Set-Cookie': await sessions.create(req, u.id) }];
});

r.post('/auth/logout', async (req) => {
  if (req.user) {
    await sessions.destroy(req.user.session_id);
    await audit(req, 'auth.logout', { actorId: req.user.id });
  }
  return [200, { ok: true }, { 'Set-Cookie': sessions.clear() }];
});

r.post('/auth/verify-email', limit('verify', 30, 3600), async (req) => {
  const userId = await consumeEmailToken(req.body.token, 'verify');
  await db.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?', [userId]);
  await audit(req, 'user.email_verified', { actorId: userId });
  return [200, { ok: true }];
});

r.post('/auth/resend-verification', requireUser, limit('resend', 5, 3600), async (req) => {
  if (req.user.email_verified_at) return [200, { ok: true, already: true }];
  return [200, { ok: true, sent: await sendVerification(req.user) }];
});

// Always answers the same way, so nobody can test which emails have accounts.
r.post('/auth/forgot', limit('forgot', 5, 3600), async (req) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = await db.one('SELECT id, email FROM users WHERE email = ?', [email]);
  if (u) {
    const token = await issueEmailToken(u.id, 'reset', 1);
    await mailer.resetPassword(u.email, `${config.urls.chat}/#/reset?token=${token}`);
    await audit(req, 'auth.reset_requested', { targetType: 'user', targetId: u.id });
  }
  return [200, { ok: true }];
});

r.post('/auth/reset', limit('reset', 10, 3600), async (req) => {
  const password = v.password(req.body.password);
  const userId = await consumeEmailToken(req.body.token, 'reset');
  await db.query('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [await hashPassword(password), userId]);
  await sessions.destroyAll(userId);
  await audit(req, 'auth.password_reset', { actorId: userId });
  return [200, { ok: true }];
});

module.exports = r;
