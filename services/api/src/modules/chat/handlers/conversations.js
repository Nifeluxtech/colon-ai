// Chat: models, usage, conversations and sharing (handlers for src/http/routes/chat/conversations.js).
// Phase 3: Colon AI chat. Conversations, streamed replies (SSE), feedback, sharing, settings and
// guest chat (streams without saving anything). Endpoint contract: docs/frontend-data-adapters.md.
const crypto = require('crypto');
const db = require('../../../db');
const config = require('../../../config');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const ai = require('../../ai');
const limits = require('../../ai').limits;
const dynamic = require('../../ai').dynamic;
const store = require('../store');
const files = require('../files');

/* ---------- Share links (read-only, anyone with the link) ---------- */
const shareUrl = (token) => `${config.urls.chat}/#/share/${token}`;

// Anyone viewing a shared chat can report it; reports land in the Admin Dashboard moderation queue.
const REPORT_REASONS = ['Harmful or dangerous', 'Hate or harassment', 'Sexual content', 'Spam or scam',
  'Private information', 'Other'];

/* ---------- Models ---------- */
// GET /models
const getModels = async () => [200, { models: ai.listModels(await dynamic.load()) }];

// GET /chat/usage
const getChatUsage = async (req) => {
  const [main] = await limits.resolveCounters(req, 'general');
  return [200, { ...(await limits.usage(main.subject, main.limit)), guest: !req.user,
    provider_configured: ai.isConfigured(await dynamic.load()) }];
};

/* ---------- Conversations ---------- */
// GET /conversations
const getConversations = async (req) => {
  const archived = String(req.query.get('archived') || '0');
  return [200, { conversations: await store.listConvs(req.user.id, { q: String(req.query.get('q') || '').trim(),
    archived }) }];
};

// POST /conversations
const postConversations = async (req) => {
  const conv = await store.createConv(req.user.id, { mode: req.body.mode, model: req.body.model });
  return [201, { conversation: store.convOut(conv) }];
};

// DELETE /conversations
const deleteConversations = async (req) => {
  await db.query('DELETE FROM chat_conversations WHERE user_id = ?', [req.user.id]);
  await files.deleteWhere(req.user.id);
  await audit(req, 'chat.deleted_all', { actorId: req.user.id });
  return [200, { ok: true }];
};

// GET /conversations/export
const getConversationsExport = async (req) => {
  const convs = await db.query('SELECT * FROM chat_conversations WHERE user_id = ? ORDER BY created_at LIMIT 5000',
    [req.user.id]);
  const out = [];
  for (const c of convs) out.push({ ...store.convOut(c), messages: await store.messages(c.id) });
  return [200, { app: 'Colon AI', exported_at: new Date().toISOString(), format: 1, account: req.user.email,
    conversations: out }];
};

// GET /conversations/:id
const getConversationsById = async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  return [200, { conversation: store.convOut(conv), messages: await store.messages(conv.id) }];
};

// PATCH /conversations/:id
const patchConversationsById = async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const sets = [], params = [];
  const b = req.body;
  if (b.title !== undefined) {
    const t = String(b.title || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 120) v.fail('title', 'Use a title of 1 to 120 characters.');
    sets.push('title = ?'); params.push(t);
  }
  if (b.pinned !== undefined) { sets.push('pinned = ?'); params.push(b.pinned ? 1 : 0); }
  if (b.archived !== undefined) { sets.push('archived = ?'); params.push(b.archived ? 1 : 0); }
  if (b.model !== undefined) { sets.push('model = ?'); params.push(b.model ? String(b.model).slice(0, 64) : null); }
  let modeChanged = false;
  if (b.mode !== undefined) {
    if (!store.MODES.includes(b.mode)) v.fail('mode', 'Choose General, Study, Developer or Research.');
    if (b.mode !== conv.mode) { sets.push('mode = ?'); params.push(b.mode); modeChanged = true; }
  }
  if (sets.length) {
    const bump = b.title !== undefined || modeChanged ? ', updated_at = UTC_TIMESTAMP(3)' : '';
    await db.query(`UPDATE chat_conversations SET ${sets.join(', ')}${bump} WHERE id = ?`, [...params, conv.id]);
  }
  if (modeChanged) {
    const has = await db.one("SELECT 1 AS x FROM chat_messages WHERE conversation_id = ? AND role <> 'event' LIMIT 1",
      [conv.id]);
    if (has) await store.insertMessage({ ...conv, mode: b.mode }, { role: 'event',
      content: `Switched to ${b.mode} mode`, mode: b.mode });
  }
  return [200, { conversation: store.convOut(await store.getConv(req.user.id, conv.id)) }];
};

// DELETE /conversations/:id
const deleteConversationsById = async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  await files.deleteWhere(req.user.id, 'conversation_id = ?', [conv.id]);
  await db.query('DELETE FROM chat_conversations WHERE id = ? AND user_id = ?', [conv.id, req.user.id]);
  return [200, { ok: true }];
};

// POST /conversations/:id/share
const postConversationsByIdShare = async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  let token = conv.share_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    await db.query('UPDATE chat_conversations SET share_token = ?, shared_at = UTC_TIMESTAMP() WHERE id = ?', [token,
      conv.id]);
    await audit(req, 'chat.shared', { actorId: req.user.id, targetType: 'conversation', targetId: conv.id });
  }
  return [200, { share: { token, url: shareUrl(token) } }];
};

// DELETE /conversations/:id/share
const deleteConversationsByIdShare = async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  await db.query('UPDATE chat_conversations SET share_token = NULL, shared_at = NULL WHERE id = ?', [conv.id]);
  return [200, { ok: true }];
};

// GET /shared/:token
const getSharedByToken = async (req) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) throw store.notFound('This shared link isn’t valid.');
  const conv = await db.one((
    'SELECT c.*, u.name AS owner_name FROM chat_conversations c JOIN users u ON u.id = c.user_id WHERE '
    + 'c.share_token = ?'), [token]);
  if (!conv) throw store.notFound('This shared link was turned off or never existed.');
  const msgs = (await store.messages(conv.id))
    .filter(m => m.role !== 'event' && (m.role === 'user' || m.status === 'complete' || m.status === 'stopped'))
    .map(m => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, mode: m.mode, model: m.model,
      status: m.status, created_at: m.created_at,
      attachments: m.attachments.map(a => ({ name: a.name, kind: a.kind, size: a.size })) }));
  return [200, {
    conversation: { title: conv.title, mode: conv.mode, model: conv.model, created_at: conv.created_at,
      shared_at: conv.shared_at, owner: conv.owner_name ? String(conv.owner_name).split(' ')[0] : null },
    messages: msgs,
  }];
};

// POST /shared/:token/report
const postSharedByTokenReport = async (req) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) throw store.notFound('This shared link isn’t valid.');
  const conv = await db.one('SELECT id FROM chat_conversations WHERE share_token = ?', [token]);
  if (!conv) throw store.notFound('This shared link was turned off or never existed.');
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : 'Other';
  const comment = req.body.comment ? String(req.body.comment).slice(0, 1000) : null;
  // One report per link and reporter (or per hashed guest IP), so repeats don't flood the queue.
  const who = req.user ? `u${req.user.id}` : crypto.createHash(
    'sha256').update(`${config.auth.appSecret}|report|${req.ip}`).digest('hex').slice(0, 16);
  await db.query(
    `INSERT INTO moderation_reports (kind, source_id, conversation_id, reporter_id, reason, comment, created_at)
     VALUES ('share', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), comment = VALUES(comment), status = 'open'`,
    [`${token}:${who}`.slice(0, 64), conv.id, req.user ? req.user.id : null, reason, comment]
  );
  await audit(req, 'chat.share_reported', { actorId: req.user ? req.user.id : null, targetType: 'conversation',
    targetId: conv.id, meta: { reason } });
  return [200, { ok: true }];
};

module.exports = { getModels, getChatUsage, getConversations, postConversations, deleteConversations,
  getConversationsExport, getConversationsById, patchConversationsById, deleteConversationsById,
  postConversationsByIdShare, deleteConversationsByIdShare, getSharedByToken, postSharedByTokenReport };
