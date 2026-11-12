// Helpers shared by the auth handlers.
const db = require('../../../db');
const config = require('../../../config');
const audit = require('../../../shared/audit');
const mailer = require('../../../shared/mailer');
const { randomToken, sha256 } = require('../../../shared/crypto');
const { isSuspended, SUSPENDED_MESSAGE } = require('../suspension');

async function issueEmailToken(userId, purpose, hours) {
  const token = randomToken(32);
  await db.query(
    'UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [userId,
    purpose]);
  await db.query(
    ('INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (?,?,?, UTC_TIMESTAMP() + INTERVAL '
      + '? HOUR)'),
    [userId, purpose, sha256(token), hours]
  );
  return token;
}

const roleFor = (email) => (config.auth.ownerEmail && email === config.auth.ownerEmail ? 'super_admin' : 'user');

async function sendVerification(user) {
  const token = await issueEmailToken(user.id, 'verify', 24);
  return mailer.verifyEmail(user.email, `${config.urls.chat}/#/verify?token=${token}`);
}

async function blockSuspended(req, userId) {
  if (await isSuspended(userId)) {
    await audit(req, 'auth.login_blocked_suspended', { targetType: 'user', targetId: userId });
    throw Object.assign(new Error(SUSPENDED_MESSAGE), { status: 403, code: 'suspended' });
  }
}

module.exports = { issueEmailToken, roleFor, sendVerification, blockSuspended };
