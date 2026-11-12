const Router = require('../router');
const db = require('../../db');
const config = require('../../config');
const v = require('../../shared/validate');
const audit = require('../../shared/audit');
const totp = require('../../modules/auth/totp');
const { hashPassword, verifyPassword, encrypt, decrypt } = require('../../shared/crypto');
const sessions = require('../../modules/auth/sessions');
const { requireUser, publicUser, deny } = require('../../modules/auth/guards');
const { limit } = require('../middleware/ratelimit');

const r = new Router();

async function checkPassword(req, password) {
  const row = await db.one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (row.password_hash && !(await verifyPassword(String(password || ''), row.password_hash))) {
    v.fail('password', 'Your password is incorrect.');
  }
}

r.patch('/account/profile', requireUser, async (req) => {
  const name = req.body.name !== undefined ? v.name(req.body.name) : req.user.name;
  const language = req.body.language !== undefined ? v.language(req.body.language) : req.user.language;
  await db.query('UPDATE users SET name = ?, language = ? WHERE id = ?', [name, language, req.user.id]);
  await audit(req, 'account.profile_updated', { actorId: req.user.id });
  return [200, { user: publicUser({ ...req.user, name, language }) }];
});

r.post('/account/password', requireUser, limit('pw-change', 10, 3600), async (req) => {
  const next = v.password(req.body.new_password, 'new_password');
  await checkPassword(req, req.body.current_password);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.user.id]);
  await sessions.destroyAll(req.user.id, req.user.session_id);
  await audit(req, 'account.password_changed', { actorId: req.user.id });
  return [200, { ok: true }];
});

r.get('/account/sessions', requireUser, async (req) => {
  const rows = await db.query(
    'SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > UTC_TIMESTAMP() ORDER BY last_seen_at DESC',
    [req.user.id]
  );
  return [200, { sessions: rows.map(s => ({ ...s, current: s.id === req.user.session_id })) }];
});

r.delete('/account/sessions/:id', requireUser, async (req) => {
  await db.query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  await audit(req, 'account.session_revoked', { actorId: req.user.id, targetType: 'session', targetId: req.params.id });
  return [200, { ok: true }];
});

r.post('/account/sessions/revoke-others', requireUser, async (req) => {
  await sessions.destroyAll(req.user.id, req.user.session_id);
  await audit(req, 'account.sessions_revoked_all', { actorId: req.user.id });
  return [200, { ok: true }];
});

// 2FA: setup returns a fresh secret (kept pending until a valid code confirms it).
r.post('/account/2fa/setup', requireUser, async (req) => {
  if (req.user.totp_enabled) deny(409, 'already_enabled', 'Two-factor is already on.');
  const secret = totp.newSecret();
  await db.query('UPDATE users SET totp_pending = ? WHERE id = ?', [encrypt(secret), req.user.id]);
  return [200, { secret, otpauth: totp.otpauthUrl(secret, req.user.email, config.auth.totpIssuer) }];
});

r.post('/account/2fa/enable', requireUser, limit('2fa', 20, 900), async (req) => {
  const row = await db.one('SELECT totp_pending FROM users WHERE id = ?', [req.user.id]);
  if (!row.totp_pending) v.fail('code', 'Start the setup again.');
  const secret = decrypt(row.totp_pending);
  if (!totp.verify(secret, req.body.code)) v.fail('code', "That code didn't work. Check the time on your phone and try again.");
  await db.query('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1 WHERE id = ?', [encrypt(secret), req.user.id]);
  await audit(req, 'account.2fa_enabled', { actorId: req.user.id });
  return [200, { ok: true }];
});

r.post('/account/2fa/disable', requireUser, limit('2fa', 20, 900), async (req) => {
  if (req.user.role !== 'user') deny(403, 'staff_2fa_required', 'Admin accounts must keep two-factor on.');
  await checkPassword(req, req.body.password);
  const row = await db.one('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
  if (!row.totp_secret || !totp.verify(decrypt(row.totp_secret), req.body.code)) v.fail('code', "That code didn't work.");
  await db.query('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', [req.user.id]);
  await audit(req, 'account.2fa_disabled', { actorId: req.user.id });
  return [200, { ok: true }];
});

r.post('/account/delete', requireUser, limit('delete', 5, 3600), async (req) => {
  if (req.user.role === 'super_admin') {
    const others = await db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND id <> ?", [req.user.id]);
    if (!others.n) deny(409, 'last_super_admin', 'You are the only Super Admin. Hand over the role before deleting your account.');
  }
  await checkPassword(req, req.body.password);
  if (req.body.confirm !== 'DELETE') v.fail('confirm', 'Type DELETE to confirm.');
  await audit(req, 'account.deleted', { actorId: req.user.id, targetType: 'user', targetId: req.user.id, meta: { email: req.user.email } });
  await db.query('DELETE FROM users WHERE id = ?', [req.user.id]); // sessions and tokens cascade
  return [200, { ok: true }, { 'Set-Cookie': sessions.clear() }];
});

module.exports = r;
