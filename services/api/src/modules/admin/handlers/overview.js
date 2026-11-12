// Admin: stats and overview (handlers for src/http/routes/admin/overview.js).
// Admin Dashboard: overview, users, moderation and security (Phase 2 + Phase 4).
// Permissions (enforced here, not just hidden in the UI):
//   moderator    moderation queue + read-only users
//   admin        everything below super_admin, except granting admin roles, provider keys and system settings
//   super_admin  everything
// Every staff endpoint needs 2FA (requireRole), and every change is written to the audit log.
const db = require('../../../db');
const dynamic = require('../../ai').dynamic;
const ai = require('../../ai');
const { n } = require('./admin-common');

/* ---------- Overview (admin+) ---------- */
async function userStats() {
  const [u] = await db.query(`SELECT COUNT(*) AS users,
      SUM(created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY) AS new_24h,
      SUM(role <> 'user') AS staff, SUM(totp_enabled) AS with_2fa FROM users`);
  const [s] = await db.query(
    'SELECT COUNT(DISTINCT user_id) AS active_7d FROM sessions WHERE last_seen_at > UTC_TIMESTAMP() - INTERVAL 7 DAY');
  const [x] = await db.query('SELECT COUNT(*) AS suspended FROM user_suspensions').catch(() => [{ suspended: 0 }]);
  return { users: n(u.users), new_24h: n(u.new_24h), staff: n(u.staff), with_2fa: n(u.with_2fa), active_7d: n(
    s.active_7d), suspended: n(x.suspended) };
}

// GET /admin/stats
const getAdminStats = async () => [200, await userStats()];

// GET /admin/overview
const getAdminOverview = async () => {
  const days = 1;
  // Keep the call log small: 30 days is plenty for the overview.
  await db.query('DELETE FROM ai_calls WHERE created_at < UTC_TIMESTAMP() - INTERVAL 30 DAY LIMIT 5000').catch(() => {
    });
  const [req] = await db.query(
    `SELECT COUNT(*) AS requests, SUM(okd = 0) AS failed, SUM(guest) AS guest FROM (
       SELECT request_id, MAX(ok) AS okd, MAX(guest) AS guest FROM ai_calls
        WHERE created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY request_id) t`, [days]);
  const [week] = await db.query(
    `SELECT COUNT(DISTINCT request_id) AS requests FROM ai_calls WHERE created_at > UTC_TIMESTAMP() - INTERVAL 7 DAY`);
  const [lat] = await db.query(
    (`SELECT AVG(ms) AS avg_ms, MAX(ms) AS max_ms FROM ai_calls WHERE ok = 1 AND created_at > UTC_TIMESTAMP() - `
      + `INTERVAL ? DAY`), [days]);
  const providers = await db.query(
    `SELECT provider, COUNT(*) AS attempts, SUM(ok) AS ok, ROUND(AVG(CASE WHEN ok = 1 THEN ms END)) AS avg_ms,
            MAX(CASE WHEN ok = 0 THEN code END) AS last_error
       FROM ai_calls WHERE provider <> '' AND created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY provider
         ORDER BY attempts DESC`, [days]);
  const models = await db.query(
    `SELECT provider, model, COUNT(*) AS attempts, SUM(ok) AS ok, ROUND(AVG(CASE WHEN ok = 1 THEN ms END)) AS avg_ms
       FROM ai_calls WHERE provider <> '' AND created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY provider, model
         ORDER BY attempts DESC LIMIT 20`, [days]);
  const errors = await db.query(
    (`SELECT code, COUNT(*) AS n FROM ai_calls WHERE ok = 0 AND created_at > UTC_TIMESTAMP() - INTERVAL ? DAY `
      + `GROUP BY code ORDER BY n DESC LIMIT 8`), [days]);
  const [msgErr] = await db.query(
    "SELECT COUNT(*) AS n FROM chat_messages WHERE status = 'error' AND created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY");
  const [modOpen] = await db.query("SELECT COUNT(*) AS n FROM moderation_reports WHERE status = 'open'");
  const cfg = await dynamic.load();
  const enabled = Object.keys(ai.enabledProviders(cfg));
  return [200, {
    users: await userStats(),
    requests: { day: n(req.requests), week: n(week.requests), failed_day: n(req.failed), guest_day: n(req.guest),
      saved_reply_errors_day: n(msgErr.n) },
    latency: { avg_ms: Math.round(n(lat.avg_ms)), max_ms: n(lat.max_ms) },
    providers: providers.map(p => ({ provider: p.provider, attempts: n(p.attempts), ok: n(p.ok), success: p.attempts
      ? Math.round((n(p.ok) / n(p.attempts)) * 100) : null, avg_ms: n(p.avg_ms), last_error: p.last_error || null,
      enabled: enabled.includes(p.provider) })),
    enabled_providers: enabled,
    models: models.map(m => ({ provider: m.provider, model: m.model, attempts: n(m.attempts), success: m.attempts
      ? Math.round((n(m.ok) / n(m.attempts)) * 100) : null, avg_ms: n(m.avg_ms) })),
    errors: errors.map(e => ({ code: e.code || 'error', n: n(e.n) })),
    moderation_open: n(modOpen.n),
    routing_source: cfg.source,
  }];
};

module.exports = { getAdminStats, getAdminOverview };
