// Admin: users (handlers for src/http/routes/admin/users.js).

const db = require('../../../db');
const audit = require('../../../shared/audit');
const v = require('../../../shared/validate');
const { RANK, deny } = require('../../auth').guards;
const { n } = require('./admin-common');

const userId = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) deny(404, 'not_found',
  'User not found.'); return id; };

async function targetUser(req) {
  const t = await db.one('SELECT id, email, role FROM users WHERE id = ?', [userId(req)]);
  if (!t) deny(404, 'not_found', 'User not found.');
  return t;
}

// Admins manage members and moderators; only a Super Admin acts on another admin. Nobody acts on themselves.
function mayManage(req, target) {
  if (target.id === req.user.id) deny(409, 'self', "You can't do this to your own account.");
  if (RANK[req.user.role] < RANK.super_admin && RANK[target.role] >= RANK.admin) deny(403, 'forbidden',
    'Only a Super Admin can manage admin accounts.');
}

/* ---------- Users (moderator: read-only; admin+: changes) ---------- */
// GET /admin/users
const getAdminUsers = async (req) => {
  const q = String(req.query.get('q') || '').trim().slice(0, 100);
  const filter = String(req.query.get('filter') || '');
  const page = Math.max(1, Number(req.query.get('page')) || 1);
  const like = `%${q}%`;
  const where = filter === 'suspended' ? 'AND s.user_id IS NOT NULL' : filter === 'staff' ? "AND u.role <> 'user'" : '';
  const rows = await db.query(
    `SELECT u.id, u.email, u.name, u.role, u.language, (u.email_verified_at IS NOT NULL) AS verified, u.totp_enabled,
      u.created_at,
            (u.locked_until IS NOT NULL AND u.locked_until > UTC_TIMESTAMP()) AS locked,
            (s.user_id IS NOT NULL) AS suspended
       FROM users u LEFT JOIN user_suspensions s ON s.user_id = u.id
      WHERE (? = '' OR u.email LIKE ? OR u.name LIKE ?) ${where} ORDER BY u.id DESC LIMIT 50 OFFSET ?`,
    [q, like, like, (page - 1) * 50]
  );
  await audit(req, 'admin.users_viewed', { actorId: req.user.id, meta: q || filter ? { q, filter } : null });
  return [200, { users: rows.map(u => ({ ...u, verified: Boolean(u.verified), totp_enabled: Boolean(u.totp_enabled),
    locked: Boolean(u.locked), suspended: Boolean(u.suspended) })), page }];
};

// GET /admin/users/:id
const getAdminUsersById = async (req) => {
  const id = userId(req);
  const u = await db.one(
    `SELECT u.id, u.email, u.name, u.role, u.language, (u.email_verified_at IS NOT NULL) AS verified, u.totp_enabled,
      u.created_at,
            (u.locked_until IS NOT NULL AND u.locked_until > UTC_TIMESTAMP()) AS locked,
            (u.google_sub IS NOT NULL) AS has_google
       FROM users u WHERE u.id = ?`, [id]);
  if (!u) deny(404, 'not_found', 'User not found.');
  const sessions = await db.query((
    'SELECT id, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND '
    + 'expires_at > UTC_TIMESTAMP() ORDER BY last_seen_at DESC LIMIT 50'), [id]);
  const susp = await db.one((
    'SELECT s.reason, s.created_at, a.email AS by_email FROM user_suspensions s LEFT JOIN users a ON a.id = '
    + 's.suspended_by WHERE s.user_id = ?'), [id]);
  const lim = await db.one('SELECT daily_limit FROM user_limits WHERE user_id = ?', [id]);
  const logins = await db.query(
    `SELECT action, ip, created_at FROM audit_log WHERE action LIKE 'auth.%' AND (actor_id = ?
      OR (target_type = 'user' AND target_id = ?))
      ORDER BY id DESC LIMIT 15`, [id, String(id)]);
  const [chat] = await db.query('SELECT COUNT(*) AS convs FROM chat_conversations WHERE user_id = ?', [id]);
  await audit(req, 'admin.user_viewed', { actorId: req.user.id, targetType: 'user', targetId: id });
  return [200, {
    user: { ...u, verified: Boolean(u.verified), totp_enabled: Boolean(u.totp_enabled), locked: Boolean(u.locked),
      has_google: Boolean(u.has_google) },
    suspension: susp || null, daily_limit: lim ? Number(lim.daily_limit) : null, conversations: n(chat.convs),
    sessions, logins,
  }];
};

// Who may grant what: admins can set user/moderator; only Super Admins can grant admin roles.
// PATCH /admin/users/:id/role
const patchAdminUsersByIdRole = async (req) => {
  const role = String(req.body.role || '');
  if (!(role in RANK)) deny(422, 'invalid', 'Unknown role.');
  const target = await targetUser(req);
  if (target.id === req.user.id) deny(409, 'self', "You can't change your own role.");
  const actor = RANK[req.user.role];
  if (actor < RANK.super_admin && (RANK[role] >= RANK.admin || RANK[target.role] >= RANK.admin)) {
    deny(403, 'forbidden', 'Only a Super Admin can grant or remove admin roles.');
  }
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
  await audit(req, 'admin.role_changed', { actorId: req.user.id, targetType: 'user', targetId: target.id,
    meta: { from: target.role, to: role } });
  return [200, { ok: true }];
};

// POST /admin/users/:id/unlock
const postAdminUsersByIdUnlock = async (req) => {
  const target = await targetUser(req);
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [target.id]);
  await audit(req, 'admin.user_unlocked', { actorId: req.user.id, targetType: 'user', targetId: target.id });
  return [200, { ok: true }];
};

// POST /admin/users/:id/signout
const postAdminUsersByIdSignout = async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  await db.query('DELETE FROM sessions WHERE user_id = ?', [target.id]);
  await audit(req, 'admin.user_signed_out', { actorId: req.user.id, targetType: 'user', targetId: target.id });
  return [200, { ok: true }];
};

// DELETE /admin/users/:id/sessions/:sid
const deleteAdminUsersByIdSessionsBySid = async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  const res = await db.query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [Number(req.params.sid), target.id]);
  if (!res.affectedRows) deny(404, 'not_found', 'That session already ended.');
  await audit(req, 'admin.session_revoked', { actorId: req.user.id, targetType: 'user', targetId: target.id,
    meta: { session: Number(req.params.sid) } });
  return [200, { ok: true }];
};

// Suspend: blocked at sign-in, and every session is revoked at once.
// POST /admin/users/:id/suspend
const postAdminUsersByIdSuspend = async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  await db.query(
    ('INSERT INTO user_suspensions (user_id, reason, suspended_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reason = '
      + 'VALUES(reason), suspended_by = VALUES(suspended_by)'),
    [target.id, reason, req.user.id]);
  await db.query('DELETE FROM sessions WHERE user_id = ?', [target.id]);
  await audit(req, 'admin.user_suspended', { actorId: req.user.id, targetType: 'user', targetId: target.id,
    meta: reason ? { reason } : null });
  return [200, { ok: true }];
};

// POST /admin/users/:id/unsuspend
const postAdminUsersByIdUnsuspend = async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  await db.query('DELETE FROM user_suspensions WHERE user_id = ?', [target.id]);
  await audit(req, 'admin.user_unsuspended', { actorId: req.user.id, targetType: 'user', targetId: target.id });
  return [200, { ok: true }];
};

// Per-user daily reply limit (null = the platform default).
// PATCH /admin/users/:id/limit
const patchAdminUsersByIdLimit = async (req) => {
  const target = await targetUser(req);
  const raw = req.body.daily_limit;
  if (raw === null || raw === '' || raw === undefined) {
    await db.query('DELETE FROM user_limits WHERE user_id = ?', [target.id]);
  } else {
    const lim = Number(raw);
    if (!Number.isInteger(lim) || lim < 0 || lim > 100000) v.fail('daily_limit',
      'Use a whole number from 0 to 100000, or leave it empty for the default.');
    await db.query((
      'INSERT INTO user_limits (user_id, daily_limit, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE '
      + 'daily_limit = VALUES(daily_limit), updated_by = VALUES(updated_by)'), [target.id, lim, req.user.id]);
  }
  await audit(req, 'admin.user_limit_set', { actorId: req.user.id, targetType: 'user', targetId: target.id,
    meta: { daily_limit: raw === '' || raw === undefined ? null : raw } });
  return [200, { ok: true }];
};

module.exports = { getAdminUsers, getAdminUsersById, patchAdminUsersByIdRole, postAdminUsersByIdUnlock,
  postAdminUsersByIdSignout, deleteAdminUsersByIdSessionsBySid, postAdminUsersByIdSuspend, postAdminUsersByIdUnsuspend,
  patchAdminUsersByIdLimit };
