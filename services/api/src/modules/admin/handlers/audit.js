// Admin: audit log and security (handlers for src/http/routes/admin/audit.js).

const db = require('../../../db');
const { n } = require('./admin-common');

/* ---------- Security (admin+): audit trail, login events, staff 2FA ---------- */
// GET /admin/audit
const getAdminAudit = async (req) => {
  const before = Number(req.query.get('before')) || Number.MAX_SAFE_INTEGER;
  const scope = req.query.get('scope') === 'logins' ? "AND a.action LIKE 'auth.%'" : req.query.get('scope') === 'admin' ? "AND a.action LIKE 'admin.%'" : '';
  const rows = await db.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.ip, a.meta, a.created_at, u.email AS actor_email, t.email AS target_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN users t ON a.target_type = 'user' AND t.id = a.target_id
      WHERE a.id < ? ${scope} ORDER BY a.id DESC LIMIT 50`,
    [before]
  );
  return [200, { entries: rows }];
};

// GET /admin/security
const getAdminSecurity = async () => {
  const staff = await db.query(
    `SELECT u.id, u.email, u.name, u.role, u.totp_enabled, (s.user_id IS NOT NULL) AS suspended,
            (SELECT MAX(created_at) FROM audit_log a WHERE a.actor_id = u.id AND a.action IN ('auth.login','auth.login_google')) AS last_login
       FROM users u LEFT JOIN user_suspensions s ON s.user_id = u.id WHERE u.role <> 'user' ORDER BY FIELD(u.role,'super_admin','admin','moderator'), u.id`);
  const [c] = await db.query(
    `SELECT SUM(action IN ('auth.login','auth.login_google')) AS logins, SUM(action = 'auth.login_failed') AS failed,
            SUM(action = 'auth.totp_failed') AS totp_failed, SUM(action = 'auth.login_blocked_suspended') AS blocked
       FROM audit_log WHERE action LIKE 'auth.%' AND created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY`);
  const [locked] = await db.query('SELECT COUNT(*) AS n FROM users WHERE locked_until > UTC_TIMESTAMP()');
  return [200, {
    staff: staff.map(s => ({ ...s, totp_enabled: Boolean(s.totp_enabled), suspended: Boolean(s.suspended) })),
    last_24h: { logins: n(c.logins), failed: n(c.failed), totp_failed: n(c.totp_failed), blocked_suspended: n(c.blocked), locked_now: n(locked.n) },
  }];
};

module.exports = { getAdminAudit, getAdminSecurity };
