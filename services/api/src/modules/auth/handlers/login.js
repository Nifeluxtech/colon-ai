// Auth: email and password sign-in (handlers for src/http/routes/auth/login.js).

const db = require('../../../db');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const totp = require('../totp');
const { verifyPassword, decrypt } = require('../../../shared/crypto');
const sessions = require('../sessions');
const { hit } = require('../../../shared/ratelimit');
const { blockSuspended } = require('./auth-common');

const LOCK_AFTER = 5;        // failed passwords

const LOCK_MINUTES = 15;

// POST /auth/login
const postAuthLogin = async (req) => {
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
  await blockSuspended(req, u.id);
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
};

module.exports = { postAuthLogin };
