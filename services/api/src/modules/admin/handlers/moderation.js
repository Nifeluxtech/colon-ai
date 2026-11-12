// Admin: moderation queue (handlers for src/http/routes/admin/moderation.js).

const db = require('../../../db');
const audit = require('../../../shared/audit');
const { deny } = require('../../auth').guards;
const { n } = require('./admin-common');

/* ---------- Moderation (moderator+) ---------- */
// Reports come from two places: "bad" feedback on a reply (chat_feedback) and reports on shared links.
async function syncFeedback() {
  await db.query(
    `INSERT IGNORE INTO moderation_reports (kind, source_id, conversation_id, reporter_id, reason, comment, created_at)
     SELECT 'feedback', f.message_id, f.conversation_id, f.user_id, f.reason, f.comment, f.created_at
       FROM chat_feedback f WHERE f.rating = 'down' AND f.created_at > UTC_TIMESTAMP() - INTERVAL 90 DAY`);
}

const excerpt = (s, max = 1200) => { s = String(s || ''); return s.length > max ? `${s.slice(0, max)}…` : s; };

async function closeReport(req, status) {
  const m = await db.one('SELECT id, kind, conversation_id FROM moderation_reports WHERE id = ?',
    [Number(req.params.id)]);
  if (!m) deny(404, 'not_found', 'Report not found.');
  const note = String(req.body.note || '').trim().slice(0, 500) || null;
  await db.query(
    'UPDATE moderation_reports SET status = ?, note = ?, resolved_by = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ?',
    [status, note, req.user.id, m.id]);
  let unshared = false;
  if (status === 'resolved' && req.body.unshare === true && m.conversation_id) {
    await db.query('UPDATE chat_conversations SET share_token = NULL, shared_at = NULL WHERE id = ?',
      [m.conversation_id]);
    unshared = true;
  }
  await audit(req, `admin.report_${status}`, { actorId: req.user.id, targetType: 'report', targetId: m.id,
    meta: { kind: m.kind, unshared, note } });
  return [200, { ok: true, unshared }];
}

// GET /admin/moderation
const getAdminModeration = async (req) => {
  await syncFeedback();
  const status = ['open', 'resolved', 'dismissed', 'all'].includes(req.query.get('status')) ? req.query.get(
    'status') : 'open';
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
  const counts = await db.query(
    'SELECT kind, COUNT(*) AS n FROM moderation_reports WHERE status = \'open\' GROUP BY kind');
  return [200, { reports: rows.map(x => ({ ...x, shared: Boolean(x.shared) })), open: Object.fromEntries(counts.map(
    c => [c.kind, n(c.n)])) }];
};

// GET /admin/moderation/:id
const getAdminModerationById = async (req) => {
  const m = await db.one('SELECT * FROM moderation_reports WHERE id = ?', [Number(req.params.id)]);
  if (!m) deny(404, 'not_found', 'Report not found.');
  const conv = m.conversation_id ? await db.one(
    'SELECT id, title, mode, share_token, user_id FROM chat_conversations WHERE id = ?', [m.conversation_id]) : null;
  let messages = [], hidden = false, gone = !conv;
  if (m.kind === 'feedback') {
    const fb = await db.one('SELECT shareable, provider, provider_model FROM chat_feedback WHERE message_id = ?',
      [m.source_id]);
    // Users can opt out of sharing feedback context ("Share feedback" off): then staff see only the reason.
    if (!fb) gone = true;
    else if (!Number(fb.shareable)) hidden = true;
    else {
      const msg = await db.one('SELECT seq, conversation_id FROM chat_messages WHERE id = ?', [m.source_id]);
      if (msg) {
        const rows = await db.query(
          `SELECT role, content, provider, provider_model, created_at FROM chat_messages
            WHERE conversation_id = ? AND seq <= ? AND role <> 'event' ORDER BY seq DESC LIMIT 2`,
              [msg.conversation_id, msg.seq]);
        messages = rows.reverse().map(x => ({ role: x.role, content: excerpt(x.content), provider: x.provider,
          model: x.provider_model, created_at: x.created_at }));
      }
    }
  } else if (conv && conv.share_token) {
    const rows = await db.query((
      "SELECT role, content, created_at FROM chat_messages WHERE conversation_id = ? AND role <> 'event' ORDER BY "
      + "seq LIMIT 40"), [conv.id]);
    messages = rows.map(x => ({ role: x.role, content: excerpt(x.content), created_at: x.created_at }));
  }
  await audit(req, 'admin.report_viewed', { actorId: req.user.id, targetType: 'report', targetId: m.id });
  return [200, { report: { id: m.id, kind: m.kind, reason: m.reason, comment: m.comment, status: m.status,
    note: m.note, created_at: m.created_at },
    conversation: conv ? { id: conv.id, title: conv.title, mode: conv.mode, shared: Boolean(conv.share_token),
      user_id: conv.user_id } : null, messages, hidden, gone }];
};

// POST /admin/moderation/:id/resolve
const postAdminModerationByIdResolve = (req) => closeReport(req, 'resolved');

// POST /admin/moderation/:id/dismiss
const postAdminModerationByIdDismiss = (req) => closeReport(req, 'dismissed');

// POST /admin/moderation/:id/reopen
const postAdminModerationByIdReopen = async (req) => {
  await db.query("UPDATE moderation_reports SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = ?",
    [Number(req.params.id)]);
  await audit(req, 'admin.report_reopened', { actorId: req.user.id, targetType: 'report', targetId: req.params.id });
  return [200, { ok: true }];
};

module.exports = { getAdminModeration, getAdminModerationById, postAdminModerationByIdResolve,
  postAdminModerationByIdDismiss, postAdminModerationByIdReopen };
