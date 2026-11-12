// Account: two-factor authentication (TOTP) (handlers for src/http/routes/account/totp.js).

const db = require('../../../db');
const config = require('../../../config');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const totp = require('../../auth').totp;
const { encrypt, decrypt } = require('../../../shared/crypto');
const { deny } = require('../../auth').guards;
const { checkPassword } = require('./account-common');

// 2FA: setup returns a fresh secret (kept pending until a valid code confirms it).
// POST /account/2fa/setup
const postAccount2faSetup = async (req) => {
  if (req.user.totp_enabled) deny(409, 'already_enabled', 'Two-factor is already on.');
  const secret = totp.newSecret();
  await db.query('UPDATE users SET totp_pending = ? WHERE id = ?', [encrypt(secret), req.user.id]);
  return [200, { secret, otpauth: totp.otpauthUrl(secret, req.user.email, config.auth.totpIssuer) }];
};

// POST /account/2fa/enable
const postAccount2faEnable = async (req) => {
  const row = await db.one('SELECT totp_pending FROM users WHERE id = ?', [req.user.id]);
  if (!row.totp_pending) v.fail('code', 'Start the setup again.');
  const secret = decrypt(row.totp_pending);
  if (!totp.verify(secret, req.body.code)) v.fail('code', "That code didn't work. Check the time on your phone and try again.");
  await db.query('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1 WHERE id = ?', [encrypt(secret), req.user.id]);
  await audit(req, 'account.2fa_enabled', { actorId: req.user.id });
  return [200, { ok: true }];
};

// POST /account/2fa/disable
const postAccount2faDisable = async (req) => {
  if (req.user.role !== 'user') deny(403, 'staff_2fa_required', 'Admin accounts must keep two-factor on.');
  await checkPassword(req, req.body.password);
  const row = await db.one('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
  if (!row.totp_secret || !totp.verify(decrypt(row.totp_secret), req.body.code)) v.fail('code', "That code didn't work.");
  await db.query('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [req.user.id]);
  await audit(req, 'account.2fa_disabled', { actorId: req.user.id });
  return [200, { ok: true }];
};

module.exports = { postAccount2faSetup, postAccount2faEnable, postAccount2faDisable };
