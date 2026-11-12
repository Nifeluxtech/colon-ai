// Admin Dashboard: overview, users, moderation and security (Phase 2 + Phase 4).
// Permissions (enforced here, not just hidden in the UI):
//   moderator    moderation queue + read-only users
//   admin        everything below super_admin, except granting admin roles, provider keys and system settings
//   super_admin  everything
// Every staff endpoint needs 2FA (requireRole), and every change is written to the audit log.
const Router = require('../router');
const db = require('../../db');
const audit = require('../../shared/audit');
const v = require('../../shared/validate');
const dynamic = require('../../modules/ai/dynamic');
const ai = require('../../modules/ai/generate');
const { requireRole, RANK, deny } = require('../../modules/auth/guards');

const r = new Router();
const n = (x) => Number(x || 0);
const userId = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) deny(404, 'not_found', 'User not found.'); return id; };

async function targetUser(req) {
  const t = await db.one('SELECT id, email, role FROM users WHERE id = ?', [userId(req)]);
  if (!t) deny(404, 'not_found', 'User not found.');
  return t;
}
// Admins manage members and moderators; only a Super Admin acts on another admin. Nobody acts on themselves.
function mayManage(req, target) {
  if (target.id === req.user.id) deny(409, 'self', "You can't do this to your own account.");
  if (RANK[req.user.role] < RANK.super_admin && RANK[target.role] >= RANK.admin) deny(403, 'forbidden', 'Only a Super Admin can manage admin accounts.');
}

/* ---------- Overview (admin+) ---------- */
async function userStats() {
  const [u] = await db.query(`SELECT COUNT(*) AS users,
      SUM(created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY) AS new_24h,
      SUM(role <> 'user') AS staff, SUM(totp_enabled) AS with_2fa FROM users`);
  const [s] = await db.query('SELECT COUNT(DISTINCT user_id) AS active_7d FROM sessions WHERE last_seen_at > UTC_TIMESTAMP() - INTERVAL 7 DAY');
  const [x] = await db.query('SELECT COUNT(*) AS suspended FROM user_suspensions').catch(() => [{ suspended: 0 }]);
  return { users: n(u.users), new_24h: n(u.new_24h), staff: n(u.staff), with_2fa: n(u.with_2fa), active_7d: n(s.active_7d), suspended: n(x.suspended) };
}

r.get('/admin/stats', requireRole('admin'), async () => [200, await userStats()]);

r.get('/admin/overview', requireRole('admin'), async () => {
  const days = 1;
  // Keep the call log small: 30 days is plenty for the overview.
  await db.query('DELETE FROM ai_calls WHERE created_at < UTC_TIMESTAMP() - INTERVAL 30 DAY LIMIT 5000').catch(() => {});
  const [req] = await db.query(
    `SELECT COUNT(*) AS requests, SUM(okd = 0) AS failed, SUM(guest) AS guest FROM (
       SELECT request_id, MAX(ok) AS okd, MAX(guest) AS guest FROM ai_calls
        WHERE created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY request_id) t`, [days]);
  const [week] = await db.query(
    `SELECT COUNT(DISTINCT request_id) AS requests FROM ai_calls WHERE created_at > UTC_TIMESTAMP() - INTERVAL 7 DAY`);
  const [lat] = await db.query(
    `SELECT AVG(ms) AS avg_ms, MAX(ms) AS max_ms FROM ai_calls WHERE ok = 1 AND created_at > UTC_TIMESTAMP() - INTERVAL ? DAY`, [days]);
  const providers = await db.query(
    `SELECT provider, COUNT(*) AS attempts, SUM(ok) AS ok, ROUND(AVG(CASE WHEN ok = 1 THEN ms END)) AS avg_ms,
            MAX(CASE WHEN ok = 0 THEN code END) AS last_error
       FROM ai_calls WHERE provider <> '' AND created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY provider ORDER BY attempts DESC`, [days]);
  const models = await db.query(
    `SELECT provider, model, COUNT(*) AS attempts, SUM(ok) AS ok, ROUND(AVG(CASE WHEN ok = 1 THEN ms END)) AS avg_ms
       FROM ai_calls WHERE provider <> '' AND created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY provider, model ORDER BY attempts DESC LIMIT 20`, [days]);
  const errors = await db.query(
    `SELECT code, COUNT(*) AS n FROM ai_calls WHERE ok = 0 AND created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY code ORDER BY n DESC LIMIT 8`, [days]);
  const [msgErr] = await db.query(
    "SELECT COUNT(*) AS n FROM chat_messages WHERE status = 'error' AND created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY");
  const [modOpen] = await db.query("SELECT COUNT(*) AS n FROM moderation_reports WHERE status = 'open'");
  const cfg = await dynamic.load();
  const enabled = Object.keys(ai.enabledProviders(cfg));
  return [200, {
    users: await userStats(),
    requests: { day: n(req.requests), week: n(week.requests), failed_day: n(req.failed), guest_day: n(req.guest), saved_reply_errors_day: n(msgErr.n) },
    latency: { avg_ms: Math.round(n(lat.avg_ms)), max_ms: n(lat.max_ms) },
    providers: providers.map(p => ({ provider: p.provider, attempts: n(p.attempts), ok: n(p.ok), success: p.attempts ? Math.round((n(p.ok) / n(p.attempts)) * 100) : null, avg_ms: n(p.avg_ms), last_error: p.last_error || null, enabled: enabled.includes(p.provider) })),
    enabled_providers: enabled,
    models: models.map(m => ({ provider: m.provider, model: m.model, attempts: n(m.attempts), success: m.attempts ? Math.round((n(m.ok) / n(m.attempts)) * 100) : null, avg_ms: n(m.avg_ms) })),
    errors: errors.map(e => ({ code: e.code || 'error', n: n(e.n) })),
    moderation_open: n(modOpen.n),
    routing_source: cfg.source,
  }];
});

/* ---------- Users (moderator: read-only; admin+: changes) ---------- */
r.get('/admin/users', requireRole('moderator'), async (req) => {
  const q = String(req.query.get('q') || '').trim().slice(0, 100);
  const filter = String(req.query.get('filter') || '');
  const page = Math.max(1, Number(req.query.get('page')) || 1);
  const like = `%${q}%`;
  const where = filter === 'suspended' ? 'AND s.user_id IS NOT NULL' : filter === 'staff' ? "AND u.role <> 'user'" : '';
  const rows = await db.query(
    `SELECT u.id, u.email, u.name, u.role, u.language, (u.email_verified_at IS NOT NULL) AS verified, u.totp_enabled, u.created_at,
            (u.locked_until IS NOT NULL AND u.locked_until > UTC_TIMESTAMP()) AS locked, (s.user_id IS NOT NULL) AS suspended
       FROM users u LEFT JOIN user_suspensions s ON s.user_id = u.id
      WHERE (? = '' OR u.email LIKE ? OR u.name LIKE ?) ${where} ORDER BY u.id DESC LIMIT 50 OFFSET ?`,
    [q, like, like, (page - 1) * 50]
  );
  await audit(req, 'admin.users_viewed', { actorId: req.user.id, meta: q || filter ? { q, filter } : null });
  return [200, { users: rows.map(u => ({ ...u, verified: Boolean(u.verified), totp_enabled: Boolean(u.totp_enabled), locked: Boolean(u.locked), suspended: Boolean(u.suspended) })), page }];
});

r.get('/admin/users/:id', requireRole('moderator'), async (req) => {
  const id = userId(req);
  const u = await db.one(
    `SELECT u.id, u.email, u.name, u.role, u.language, (u.email_verified_at IS NOT NULL) AS verified, u.totp_enabled, u.created_at,
            (u.locked_until IS NOT NULL AND u.locked_until > UTC_TIMESTAMP()) AS locked, (u.google_sub IS NOT NULL) AS has_google
       FROM users u WHERE u.id = ?`, [id]);
  if (!u) deny(404, 'not_found', 'User not found.');
  const sessions = await db.query('SELECT id, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > UTC_TIMESTAMP() ORDER BY last_seen_at DESC LIMIT 50', [id]);
  const susp = await db.one('SELECT s.reason, s.created_at, a.email AS by_email FROM user_suspensions s LEFT JOIN users a ON a.id = s.suspended_by WHERE s.user_id = ?', [id]);
  const lim = await db.one('SELECT daily_limit FROM user_limits WHERE user_id = ?', [id]);
  const logins = await db.query(
    `SELECT action, ip, created_at FROM audit_log WHERE action LIKE 'auth.%' AND (actor_id = ? OR (target_type = 'user' AND target_id = ?))
      ORDER BY id DESC LIMIT 15`, [id, String(id)]);
  const [chat] = await db.query('SELECT COUNT(*) AS convs FROM chat_conversations WHERE user_id = ?', [id]);
  await audit(req, 'admin.user_viewed', { actorId: req.user.id, targetType: 'user', targetId: id });
  return [200, {
    user: { ...u, verified: Boolean(u.verified), totp_enabled: Boolean(u.totp_enabled), locked: Boolean(u.locked), has_google: Boolean(u.has_google) },
    suspension: susp || null, daily_limit: lim ? Number(lim.daily_limit) : null, conversations: n(chat.convs),
    sessions, logins,
  }];
});

// Who may grant what: admins can set user/moderator; only Super Admins can grant admin roles.
r.patch('/admin/users/:id/role', requireRole('admin'), async (req) => {
  const role = String(req.body.role || '');
  if (!(role in RANK)) deny(422, 'invalid', 'Unknown role.');
  const target = await targetUser(req);
  if (target.id === req.user.id) deny(409, 'self', "You can't change your own role.");
  const actor = RANK[req.user.role];
  if (actor < RANK.super_admin && (RANK[role] >= RANK.admin || RANK[target.role] >= RANK.admin)) {
    deny(403, 'forbidden', 'Only a Super Admin can grant or remove admin roles.');
  }
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
  await audit(req, 'admin.role_changed', { actorId: req.user.id, targetType: 'user', targetId: target.id, meta: { from: target.role, to: role } });
  return [200, { ok: true }];
});

r.post('/admin/users/:id/unlock', requireRole('admin'), async (req) => {
  const target = await targetUser(req);
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [target.id]);
  await audit(req, 'admin.user_unlocked', { actorId: req.user.id, targetType: 'user', targetId: target.id });
  return [200, { ok: true }];
});

r.post('/admin/users/:id/signout', requireRole('admin'), async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  await db.query('DELETE FROM sessions WHERE user_id = ?', [target.id]);
  await audit(req, 'admin.user_signed_out', { actorId: req.user.id, targetType: 'user', targetId: target.id });
  return [200, { ok: true }];
});

r.delete('/admin/users/:id/sessions/:sid', requireRole('admin'), async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  const res = await db.query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [Number(req.params.sid), target.id]);
  if (!res.affectedRows) deny(404, 'not_found', 'That session already ended.');
  await audit(req, 'admin.session_revoked', { actorId: req.user.id, targetType: 'user', targetId: target.id, meta: { session: Number(req.params.sid) } });
  return [200, { ok: true }];
});

// Suspend: blocked at sign-in, and every session is revoked at once.
r.post('/admin/users/:id/suspend', requireRole('admin'), async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  await db.query(
    'INSERT INTO user_suspensions (user_id, reason, suspended_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reason = VALUES(reason), suspended_by = VALUES(suspended_by)',
    [target.id, reason, req.user.id]);
  await db.query('DELETE FROM sessions WHERE user_id = ?', [target.id]);
  await audit(req, 'admin.user_suspended', { actorId: req.user.id, targetType: 'user', targetId: target.id, meta: reason ? { reason } : null });
  return [200, { ok: true }];
});

r.post('/admin/users/:id/unsuspend', requireRole('admin'), async (req) => {
  const target = await targetUser(req);
  mayManage(req, target);
  await db.query('DELETE FROM user_suspensions WHERE user_id = ?', [target.id]);
  await audit(req, 'admin.user_unsuspended', { actorId: req.user.id, targetType: 'user', targetId: target.id });
  return [200, { ok: true }];
});

// Per-user daily reply limit (null = the platform default).
r.patch('/admin/users/:id/limit', requireRole('admin'), async (req) => {
  const target = await targetUser(req);
  const raw = req.body.daily_limit;
  if (raw === null || raw === '' || raw === undefined) {
    await db.query('DELETE FROM user_limits WHERE user_id = ?', [target.id]);
  } else {
    const lim = Number(raw);
    if (!Number.isInteger(lim) || lim < 0 || lim > 100000) v.fail('daily_limit', 'Use a whole number from 0 to 100000, or leave it empty for the default.');
    await db.query('INSERT INTO user_limits (user_id, daily_limit, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE daily_limit = VALUES(daily_limit), updated_by = VALUES(updated_by)', [target.id, lim, req.user.id]);
  }
  await audit(req, 'admin.user_limit_set', { actorId: req.user.id, targetType: 'user', targetId: target.id, meta: { daily_limit: raw === '' || raw === undefined ? null : raw } });
  return [200, { ok: true }];
});

/* ---------- Moderation (moderator+) ---------- */
// Reports come from two places: "bad" feedback on a reply (chat_feedback) and reports on shared links.
async function syncFeedback() {
  await db.query(
    `INSERT IGNORE INTO moderation_reports (kind, source_id, conversation_id, reporter_id, reason, comment, created_at)
     SELECT 'feedback', f.message_id, f.conversation_id, f.user_id, f.reason, f.comment, f.created_at
       FROM chat_feedback f WHERE f.rating = 'down' AND f.created_at > UTC_TIMESTAMP() - INTERVAL 90 DAY`);
}

r.get('/admin/moderation', requireRole('moderator'), async (req) => {
  await syncFeedback();
  const status = ['open', 'resolved', 'dismissed', 'all'].includes(req.query.get('status')) ? req.query.get('status') : 'open';
  const kind = ['feedback', 'share'].includes(req.query.get('kind')) ? req.query.get('kind') : '';
  const rows = await db.query(
    `SELECT m.id, m.kind, m.conversation_id, m.reason, m.comment, m.status, m.note, m.created_at, m.resolved_at,
            c.title, c.share_token IS NOT NULL AS shared, ru.email AS reporter_email, rb.email AS resolved_by_email
       FROM moderation_reports m
       LEFT JOIN chat_conversations c ON c.id = m.conversation_id
       LEFT JOIN users ru ON ru.id = m.reporter_id
       LEFT JOIN users rb ON rb.id = m.resolved_by
      WHERE (? = 'all' OR m.status = ?) AND (? = '' OR m.kind = ?)
      ORDER BY m.id DESC LIMIT 100`, [status, status, kind, kind]);
  const counts = await db.query('SELECT kind, COUNT(*) AS n FROM moderation_reports WHERE status = \'open\' GROUP BY kind');
  return [200, { reports: rows.map(x => ({ ...x, shared: Boolean(x.shared) })), open: Object.fromEntries(counts.map(c => [c.kind, n(c.n)])) }];
});

const excerpt = (s, max = 1200) => { s = String(s || ''); return s.length > max ? `${s.slice(0, max)}…` : s; };

r.get('/admin/moderation/:id', requireRole('moderator'), async (req) => {
  const m = await db.one('SELECT * FROM moderation_reports WHERE id = ?', [Number(req.params.id)]);
  if (!m) deny(404, 'not_found', 'Report not found.');
  const conv = m.conversation_id ? await db.one('SELECT id, title, mode, share_token, user_id FROM chat_conversations WHERE id = ?', [m.conversation_id]) : null;
  let messages = [], hidden = false, gone = !conv;
  if (m.kind === 'feedback') {
    const fb = await db.one('SELECT shareable, provider, provider_model FROM chat_feedback WHERE message_id = ?', [m.source_id]);
    // Users can opt out of sharing feedback context ("Share feedback" off): then staff see only the reason.
    if (!fb) gone = true;
    else if (!Number(fb.shareable)) hidden = true;
    else {
      const msg = await db.one('SELECT seq, conversation_id FROM chat_messages WHERE id = ?', [m.source_id]);
      if (msg) {
        const rows = await db.query(
          `SELECT role, content, provider, provider_model, created_at FROM chat_messages
            WHERE conversation_id = ? AND seq <= ? AND role <> 'event' ORDER BY seq DESC LIMIT 2`, [msg.conversation_id, msg.seq]);
        messages = rows.reverse().map(x => ({ role: x.role, content: excerpt(x.content), provider: x.provider, model: x.provider_model, created_at: x.created_at }));
      }
    }
  } else if (conv && conv.share_token) {
    const rows = await db.query("SELECT role, content, created_at FROM chat_messages WHERE conversation_id = ? AND role <> 'event' ORDER BY seq LIMIT 40", [conv.id]);
    messages = rows.map(x => ({ role: x.role, content: excerpt(x.content), created_at: x.created_at }));
  }
  await audit(req, 'admin.report_viewed', { actorId: req.user.id, targetType: 'report', targetId: m.id });
  return [200, { report: { id: m.id, kind: m.kind, reason: m.reason, comment: m.comment, status: m.status, note: m.note, created_at: m.created_at },
    conversation: conv ? { id: conv.id, title: conv.title, mode: conv.mode, shared: Boolean(conv.share_token), user_id: conv.user_id } : null, messages, hidden, gone }];
});

async function closeReport(req, status) {
  const m = await db.one('SELECT id, kind, conversation_id FROM moderation_reports WHERE id = ?', [Number(req.params.id)]);
  if (!m) deny(404, 'not_found', 'Report not found.');
  const note = String(req.body.note || '').trim().slice(0, 500) || null;
  await db.query('UPDATE moderation_reports SET status = ?, note = ?, resolved_by = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ?', [status, note, req.user.id, m.id]);
  let unshared = false;
  if (status === 'resolved' && req.body.unshare === true && m.conversation_id) {
    await db.query('UPDATE chat_conversations SET share_token = NULL, shared_at = NULL WHERE id = ?', [m.conversation_id]);
    unshared = true;
  }
  await audit(req, `admin.report_${status}`, { actorId: req.user.id, targetType: 'report', targetId: m.id, meta: { kind: m.kind, unshared, note } });
  return [200, { ok: true, unshared }];
}
r.post('/admin/moderation/:id/resolve', requireRole('moderator'), (req) => closeReport(req, 'resolved'));
r.post('/admin/moderation/:id/dismiss', requireRole('moderator'), (req) => closeReport(req, 'dismissed'));
r.post('/admin/moderation/:id/reopen', requireRole('moderator'), async (req) => {
  await db.query("UPDATE moderation_reports SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = ?", [Number(req.params.id)]);
  await audit(req, 'admin.report_reopened', { actorId: req.user.id, targetType: 'report', targetId: req.params.id });
  return [200, { ok: true }];
});

/* ---------- Security (admin+): audit trail, login events, staff 2FA ---------- */
r.get('/admin/audit', requireRole('admin'), async (req) => {
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
});

r.get('/admin/security', requireRole('admin'), async () => {
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
});

module.exports = r;
