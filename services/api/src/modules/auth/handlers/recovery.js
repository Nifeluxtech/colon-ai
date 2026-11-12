// Auth: email verification and password reset (handlers for src/http/routes/auth/recovery.js).

const db = require('../../../db');
const config = require('../../../config');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const mailer = require('../../../shared/mailer');
const { hashPassword, sha256 } = require('../../../shared/crypto');
const sessions = require('../sessions');
const { issueEmailToken, sendVerification } = require('./auth-common');

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

// POST /auth/verify-email
const postAuthVerifyEmail = async (req) => {
  const userId = await consumeEmailToken(req.body.token, 'verify');
  await db.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?',
    [userId]);
  await audit(req, 'user.email_verified', { actorId: userId });
  return [200, { ok: true }];
};

// POST /auth/resend-verification
const postAuthResendVerification = async (req) => {
  if (req.user.email_verified_at) return [200, { ok: true, already: true }];
  return [200, { ok: true, sent: await sendVerification(req.user) }];
};

// Always answers the same way, so nobody can test which emails have accounts.
// POST /auth/forgot
const postAuthForgot = async (req) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = await db.one('SELECT id, email FROM users WHERE email = ?', [email]);
  if (u) {
    const token = await issueEmailToken(u.id, 'reset', 1);
    await mailer.resetPassword(u.email, `${config.urls.chat}/#/reset?token=${token}`);
    await audit(req, 'auth.reset_requested', { targetType: 'user', targetId: u.id });
  }
  return [200, { ok: true }];
};

// POST /auth/reset
const postAuthReset = async (req) => {
  const password = v.password(req.body.password);
  const userId = await consumeEmailToken(req.body.token, 'reset');
  await db.query('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
    [await hashPassword(password), userId]);
  await sessions.destroyAll(userId);
  await audit(req, 'auth.password_reset', { actorId: userId });
  return [200, { ok: true }];
};

module.exports = { postAuthVerifyEmail, postAuthResendVerification, postAuthForgot, postAuthReset };
