const Router = require('../router');
const db = require('../../db');
const audit = require('../../lib/audit');
const { requireRole, RANK, deny } = require('../../auth/guards');

const r = new Router();

r.get('/admin/stats', requireRole('moderator'), async () => {
  const [u] = await db.query(`SELECT COUNT(*) AS users,
      SUM(created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY) AS new_24h,
      SUM(role <> 'user') AS staff, SUM(totp_enabled) AS with_2fa FROM users`);
  const [s] = await db.query('SELECT COUNT(DISTINCT user_id) AS active_7d FROM sessions WHERE last_seen_at > UTC_TIMESTAMP() - INTERVAL 7 DAY');
  return [200, { users: Number(u.users), new_24h: Number(u.new_24h || 0), staff: Number(u.staff || 0), with_2fa: Number(u.with_2fa || 0), active_7d: Number(s.active_7d) }];
});

r.get('/admin/users', requireRole('moderator'), async (req) => {
  const q = String(req.query.get('q') || '').trim().slice(0, 100);
  const page = Math.max(1, Number(req.query.get('page')) || 1);
  const like = `%${q}%`;
  const rows = await db.query(
    `SELECT id, email, name, role, language, (email_verified_at IS NOT NULL) AS verified, totp_enabled, created_at,
            (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS locked
       FROM users WHERE (? = '' OR email LIKE ? OR name LIKE ?) ORDER BY id DESC LIMIT 50 OFFSET ?`,
    [q, like, like, (page - 1) * 50]
  );
  await audit(req, 'admin.users_viewed', { actorId: req.user.id, meta: q ? { q } : null });
  return [200, { users: rows.map(u => ({ ...u, verified: Boolean(u.verified), totp_enabled: Boolean(u.totp_enabled), locked: Boolean(u.locked) })), page }];
});

// Who may grant what: admins can set user/moderator; only Super Admins can grant admin roles.
r.patch('/admin/users/:id/role', requireRole('admin'), async (req) => {
  const role = String(req.body.role || '');
  if (!(role in RANK)) deny(422, 'invalid', 'Unknown role.');
  const target = await db.one('SELECT id, role FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!target) deny(404, 'not_found', 'User not found.');
  if (target.id === req.user.id) deny(409, 'self', "You can't change your own role.");
  const actor = RANK[req.user.role];
  if (actor < RANK.super_admin && (RANK[role] >= RANK.admin || RANK[target.role] >= RANK.admin)) {
    deny(403, 'forbidden', 'Only a Super Admin can grant or remove admin roles.');
  }
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
  await audit(req, 'admin.role_changed', { actorId: req.user.id, targetType: 'user', targetId: target.id, meta: { from: target.role, to: role } });
  return [200, { ok: true }];
});

r.post('/admin/users/:id/unlock', requireRole('moderator'), async (req) => {
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [Number(req.params.id)]);
  await audit(req, 'admin.user_unlocked', { actorId: req.user.id, targetType: 'user', targetId: req.params.id });
  return [200, { ok: true }];
});

r.post('/admin/users/:id/signout', requireRole('admin'), async (req) => {
  await db.query('DELETE FROM sessions WHERE user_id = ?', [Number(req.params.id)]);
  await audit(req, 'admin.user_signed_out', { actorId: req.user.id, targetType: 'user', targetId: req.params.id });
  return [200, { ok: true }];
});

r.get('/admin/audit', requireRole('admin'), async (req) => {
  const before = Number(req.query.get('before')) || Number.MAX_SAFE_INTEGER;
  const rows = await db.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.ip, a.meta, a.created_at, u.email AS actor_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.id < ? ORDER BY a.id DESC LIMIT 50`,
    [before]
  );
  return [200, { entries: rows }];
});

module.exports = r;
