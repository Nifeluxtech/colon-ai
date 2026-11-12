// Phase 3: Colon AI chat. Conversations, streamed replies (SSE), feedback, sharing, settings and
// guest chat (streams without saving anything). Endpoint contract: docs/frontend-data-adapters.md.
const crypto = require('crypto');
const Router = require('../router');
const db = require('../../db');
const config = require('../../config');
const v = require('../../shared/validate');
const audit = require('../../shared/audit');
const ai = require('../../modules/ai/generate');
const limits = require('../../modules/ai/limits');
const dynamic = require('../../modules/ai/dynamic');
const settings = require('../../shared/settings');
const { replyLanguage } = require('../../modules/ai/prompts');
const store = require('../../modules/chat/store');
const files = require('../../modules/chat/files');
const { buildMessages } = require('../../modules/chat/context');
const { respond, stopLocal } = require('../../modules/chat/reply');
const { requireUser, deny } = require('../../modules/auth/guards');
const { limit, hit } = require('../middleware/ratelimit');

const r = new Router();
const MAX_CONTENT = 16000;
const perUser = (name, max, windowSec) => async (req) => { await hit(`${name}:u${req.user.id}`, max, windowSec); };

/* ---------- Models ---------- */
r.get('/models', async () => [200, { models: ai.listModels(await dynamic.load()) }]);

r.get('/chat/usage', async (req) => {
  const [main] = await limits.resolveCounters(req, 'general');
  return [200, { ...(await limits.usage(main.subject, main.limit)), guest: !req.user, provider_configured: ai.isConfigured(await dynamic.load()) }];
});

/* ---------- Conversations ---------- */
r.get('/conversations', requireUser, async (req) => {
  const archived = String(req.query.get('archived') || '0');
  return [200, { conversations: await store.listConvs(req.user.id, { q: String(req.query.get('q') || '').trim(), archived }) }];
});

r.post('/conversations', requireUser, perUser('chat-create', 60, 600), async (req) => {
  const conv = await store.createConv(req.user.id, { mode: req.body.mode, model: req.body.model });
  return [201, { conversation: store.convOut(conv) }];
});

r.delete('/conversations', requireUser, async (req) => {
  await db.query('DELETE FROM chat_conversations WHERE user_id = ?', [req.user.id]);
  await files.deleteWhere(req.user.id);
  await audit(req, 'chat.deleted_all', { actorId: req.user.id });
  return [200, { ok: true }];
});

r.get('/conversations/export', requireUser, perUser('chat-export', 10, 3600), async (req) => {
  const convs = await db.query('SELECT * FROM chat_conversations WHERE user_id = ? ORDER BY created_at LIMIT 5000', [req.user.id]);
  const out = [];
  for (const c of convs) out.push({ ...store.convOut(c), messages: await store.messages(c.id) });
  return [200, { app: 'Colon AI', exported_at: new Date().toISOString(), format: 1, account: req.user.email, conversations: out }];
});

r.get('/conversations/:id', requireUser, async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  return [200, { conversation: store.convOut(conv), messages: await store.messages(conv.id) }];
});

r.patch('/conversations/:id', requireUser, async (req) => {
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
    const has = await db.one("SELECT 1 AS x FROM chat_messages WHERE conversation_id = ? AND role <> 'event' LIMIT 1", [conv.id]);
    if (has) await store.insertMessage({ ...conv, mode: b.mode }, { role: 'event', content: `Switched to ${b.mode} mode`, mode: b.mode });
  }
  return [200, { conversation: store.convOut(await store.getConv(req.user.id, conv.id)) }];
});

r.delete('/conversations/:id', requireUser, async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  await files.deleteWhere(req.user.id, 'conversation_id = ?', [conv.id]);
  await db.query('DELETE FROM chat_conversations WHERE id = ? AND user_id = ?', [conv.id, req.user.id]);
  return [200, { ok: true }];
});

/* ---------- Share links (read-only, anyone with the link) ---------- */
const shareUrl = (token) => `${config.urls.chat}/#/share/${token}`;
r.post('/conversations/:id/share', requireUser, settings.feature('sharing'), perUser('chat-share', 30, 3600), async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  let token = conv.share_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    await db.query('UPDATE chat_conversations SET share_token = ?, shared_at = UTC_TIMESTAMP() WHERE id = ?', [token, conv.id]);
    await audit(req, 'chat.shared', { actorId: req.user.id, targetType: 'conversation', targetId: conv.id });
  }
  return [200, { share: { token, url: shareUrl(token) } }];
});

r.delete('/conversations/:id/share', requireUser, async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  await db.query('UPDATE chat_conversations SET share_token = NULL, shared_at = NULL WHERE id = ?', [conv.id]);
  return [200, { ok: true }];
});

r.get('/shared/:token', limit('shared-view', 120, 600), async (req) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) throw store.notFound('This shared link isn’t valid.');
  const conv = await db.one('SELECT c.*, u.name AS owner_name FROM chat_conversations c JOIN users u ON u.id = c.user_id WHERE c.share_token = ?', [token]);
  if (!conv) throw store.notFound('This shared link was turned off or never existed.');
  const msgs = (await store.messages(conv.id))
    .filter(m => m.role !== 'event' && (m.role === 'user' || m.status === 'complete' || m.status === 'stopped'))
    .map(m => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, mode: m.mode, model: m.model, status: m.status, created_at: m.created_at,
      attachments: m.attachments.map(a => ({ name: a.name, kind: a.kind, size: a.size })) }));
  return [200, {
    conversation: { title: conv.title, mode: conv.mode, model: conv.model, created_at: conv.created_at, shared_at: conv.shared_at, owner: conv.owner_name ? String(conv.owner_name).split(' ')[0] : null },
    messages: msgs,
  }];
});

// Anyone viewing a shared chat can report it; reports land in the Admin Dashboard moderation queue.
const REPORT_REASONS = ['Harmful or dangerous', 'Hate or harassment', 'Sexual content', 'Spam or scam', 'Private information', 'Other'];
r.post('/shared/:token/report', limit('shared-report', 10, 3600), async (req) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) throw store.notFound('This shared link isn’t valid.');
  const conv = await db.one('SELECT id FROM chat_conversations WHERE share_token = ?', [token]);
  if (!conv) throw store.notFound('This shared link was turned off or never existed.');
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : 'Other';
  const comment = req.body.comment ? String(req.body.comment).slice(0, 1000) : null;
  // One report per link and reporter (or per hashed guest IP), so repeats don't flood the queue.
  const who = req.user ? `u${req.user.id}` : crypto.createHash('sha256').update(`${config.auth.appSecret}|report|${req.ip}`).digest('hex').slice(0, 16);
  await db.query(
    `INSERT INTO moderation_reports (kind, source_id, conversation_id, reporter_id, reason, comment, created_at)
     VALUES ('share', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), comment = VALUES(comment), status = 'open'`,
    [`${token}:${who}`.slice(0, 64), conv.id, req.user ? req.user.id : null, reason, comment]
  );
  await audit(req, 'chat.share_reported', { actorId: req.user ? req.user.id : null, targetType: 'conversation', targetId: conv.id, meta: { reason } });
  return [200, { ok: true }];
});

/* ---------- Replies ---------- */
function persistedStore(conv, { version = 1 } = {}) {
  let id = null;
  return {
    async start() {
      const m = await store.insertMessage(conv, { role: 'assistant', content: '', status: 'streaming', version });
      id = m.id;
      return m;
    },
    async finish({ content, status, error, providerId, providerModel, sources, web }) {
      await db.query(
        'UPDATE chat_messages SET content = ?, status = ?, error = ?, provider = ?, provider_model = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?',
        [content || '', status, error ? JSON.stringify(error) : null, providerId || null, providerModel || null, id]
      );
      // Research mode: the cited sources and how the search went (migration 0006). Separate, so a database
      // that hasn't run 0006 yet still saves the answer itself.
      if (web) {
        await db.query('UPDATE chat_messages SET sources = ?, web_search = ? WHERE id = ?', [JSON.stringify(sources || []), JSON.stringify(web), id])
          .catch(() => db.query('UPDATE chat_messages SET sources = ? WHERE id = ?', [JSON.stringify(sources || []), id]).catch(() => {}));
      }
      if (content) await store.touch(conv, { preview: content });
      return store.getMessage(conv.id, id);
    },
    async isStopped() {
      const row = await db.one('SELECT status FROM chat_messages WHERE id = ?', [id]);
      return Boolean(row && row.status === 'stopped');
    },
  };
}

// History (user/assistant turns that finished) up to and including the user message being answered.
async function historyFor(req, conv, uptoMessageId) {
  const all = await store.messages(conv.id);
  const end = all.findIndex(m => m.id === uptoMessageId);
  const turns = all.slice(0, end + 1).filter(m => m.role === 'user' || (m.role === 'assistant' && (m.status === 'complete' || m.status === 'stopped') && m.content));
  const latest = turns.length - 1;
  const fileLists = await files.forModel(req.user.id, turns.map(m => m.attachments || []), latest);
  return turns.map((m, i) => ({ role: m.role, content: m.content, files: fileLists[i] }));
}

async function seqOf(id) {
  const row = await db.one('SELECT seq FROM chat_messages WHERE id = ?', [id]);
  return row ? row.seq : null;
}

// Research mode searches the web first (Phase 5, docs/phase-5-research.md). Other modes never do.
const wantsWeb = (mode) => mode === 'research';
const previousUserText = (history) => {
  const users = history.filter(m => m.role === 'user');
  return users.length > 1 ? String(users[users.length - 2].content || '') : '';
};

async function streamFor(req, res, conv, userMsg, { version = 1, onOpen } = {}) {
  const counters = await limits.resolveCounters(req, conv.mode);
  return historyFor(req, conv, userMsg.id).then(history => respond({
    req, res, mode: conv.mode, model: conv.model, language: replyLanguage(req.user.language, userMsg.content), name: req.user.name,
    history: buildMessages(history), counters, store: persistedStore(conv, { version }), onOpen,
    webSearch: wantsWeb(conv.mode), searchText: userMsg.content, searchPrevious: previousUserText(history),
  }));
}

function cleanContent(raw) {
  const content = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
  if (content.length > MAX_CONTENT) v.fail('content', `Messages can be up to ${MAX_CONTENT} characters.`);
  return content.trim();
}

r.post('/conversations/:id/messages', requireUser, perUser('chat-send', 20, 60), async (req, res) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const content = cleanContent(req.body.content);
  const ids = Array.isArray(req.body.attachment_ids) ? req.body.attachment_ids : [];
  if (!content && !ids.length) v.fail('content', 'Type a message first.');
  const atts = await store.claimAttachments(req.user.id, ids, conv, null);
  const userMsg = await store.insertMessage(conv, { role: 'user', content, attachments: atts.map(store.attachmentOut) });
  if (atts.length) await store.claimAttachments(req.user.id, ids, conv, userMsg.id);
  const title = conv.title === 'New chat' ? store.titleFrom(content || (atts[0] && atts[0].name)) : null;
  await store.touch(conv, { title, preview: content || (atts[0] && atts[0].name) });
  const fresh = await store.getConv(req.user.id, conv.id);
  await streamFor(req, res, fresh, userMsg, { onOpen: (sse) => sse.send('user', { message: userMsg, conversation: store.convOut(fresh) }) });
});

r.post('/conversations/:id/messages/:mid/regenerate', requireUser, perUser('chat-send', 20, 60), async (req, res) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const all = await store.messages(conv.id);
  const idx = all.findIndex(m => m.id === req.params.mid && m.role === 'assistant');
  // An error card the app made itself (no saved message) retries the latest question.
  const before = idx > -1 ? all.slice(0, idx) : all;
  const userMsg = [...before].reverse().find(m => m.role === 'user');
  if (!userMsg) v.fail('message', 'There’s nothing to regenerate yet.');
  const version = idx > -1 ? (all[idx].version || 1) + 1 : 1;
  await db.query('DELETE FROM chat_messages WHERE conversation_id = ? AND seq > ?', [conv.id, await seqOf(userMsg.id)]);
  await streamFor(req, res, conv, userMsg, { version });
});

r.post('/conversations/:id/messages/:mid/edit', requireUser, perUser('chat-send', 20, 60), async (req, res) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const msg = await store.getMessage(conv.id, req.params.mid);
  if (!msg || msg.role !== 'user') throw store.notFound('This message no longer exists.');
  const content = cleanContent(req.body.content);
  if (!content && !(msg.attachments || []).length) v.fail('content', 'Type a message first.');
  await db.query('UPDATE chat_messages SET content = ? WHERE id = ?', [content, msg.id]);
  await db.query('DELETE FROM chat_messages WHERE conversation_id = ? AND seq > ?', [conv.id, await seqOf(msg.id)]);
  await store.touch(conv, { preview: content });
  const userMsg = await store.getMessage(conv.id, msg.id);
  await streamFor(req, res, conv, userMsg, { onOpen: (sse) => sse.send('user', { message: userMsg, conversation: store.convOut(conv) }) });
});

r.post('/conversations/:id/messages/:mid/stop', requireUser, async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const mid = String(req.params.mid);
  if (!stopLocal(mid)) {
    // Another worker holds the stream: flag it; that worker checks every 2 seconds and stops.
    await db.query("UPDATE chat_messages SET status = 'stopped' WHERE id = ? AND conversation_id = ? AND status = 'streaming'", [mid, conv.id]);
  }
  return [200, { ok: true }];
});

// AI Browse summaries and other assistant notes written by the app.
r.post('/conversations/:id/notes', requireUser, perUser('chat-note', 30, 600), async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const content = String(req.body.content || '').slice(0, 60000).trim();
  if (!content) v.fail('content', 'The note is empty.');
  const sources = (Array.isArray(req.body.sources) ? req.body.sources : []).slice(0, 20).map((s, i) => ({
    n: Number(s.n) || i + 1, title: String(s.title || '').slice(0, 200), url: /^https?:\/\//i.test(String(s.url || '')) ? String(s.url).slice(0, 2000) : '', snippet: String(s.snippet || '').slice(0, 500),
  })).filter(s => s.url);
  const origin = req.body.origin === 'browse' ? 'browse' : 'note';
  const msg = await store.insertMessage(conv, { role: 'assistant', content, sources, status: 'complete', origin });
  await store.touch(conv, { preview: content, title: conv.title === 'New chat' && req.body.title ? store.titleFrom(req.body.title) : null });
  return [201, { message: msg }];
});

/* ---------- Feedback ---------- */
const REASONS = ['Not accurate', 'Not helpful', 'Wrong language', 'Unsafe or harmful', 'Too long', 'Other'];
r.post('/messages/:id/feedback', requireUser, perUser('chat-feedback', 120, 3600), async (req) => {
  const m = await db.one(
    `SELECT m.id, m.conversation_id, m.mode, m.provider, m.provider_model, m.role FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id WHERE m.id = ? AND c.user_id = ?`, [String(req.params.id), req.user.id]);
  if (!m || m.role !== 'assistant') throw store.notFound('This reply no longer exists.');
  const rating = req.body.rating;
  if (!rating) {
    await db.query('DELETE FROM chat_feedback WHERE message_id = ?', [m.id]);
    return [200, { ok: true, feedback: null }];
  }
  if (rating !== 'up' && rating !== 'down') v.fail('rating', 'Choose good or bad.');
  const reason = rating === 'down' ? (REASONS.includes(req.body.reason) ? req.body.reason : 'Other') : null;
  const comment = req.body.comment ? String(req.body.comment).slice(0, 1000) : null;
  const settings = await loadSettings(req.user.id);
  await db.query(
    `INSERT INTO chat_feedback (message_id, user_id, conversation_id, rating, reason, comment, mode, provider, provider_model, shareable, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), reason = VALUES(reason), comment = VALUES(comment), shareable = VALUES(shareable), updated_at = UTC_TIMESTAMP(3)`,
    [m.id, req.user.id, m.conversation_id, rating, reason, comment, m.mode, m.provider, m.provider_model, settings.shareFeedback === false ? 0 : 1]
  );
  return [200, { ok: true, feedback: { rating, reason, comment } }];
});

/* ---------- Chat settings & stats ---------- */
const DEFAULT_SETTINGS = {
  enterToSend: true, defaultMode: 'general', defaultModel: null, showMeta: true, linksInPanel: true, browserLayout: 'split',
  streaming: true, textSize: 'md', saveHistory: true, shareFeedback: true,
  voice: { lang: 'en-NG', method: 'auto', autoSend: false, readAloudRate: 1 },
};
const BOOLS = ['enterToSend', 'showMeta', 'linksInPanel', 'streaming', 'saveHistory', 'shareFeedback'];
const ENUMS = { defaultMode: store.MODES, browserLayout: ['split', 'embedded'], textSize: ['sm', 'md', 'lg'] };
const VOICE = { lang: ['en-NG', 'en-GB', 'en-US', 'yo-NG', 'ha-NG', 'ig-NG'], method: ['auto', 'dictation', 'recorder'], readAloudRate: [0.8, 1, 1.25] };

async function loadSettings(userId) {
  const row = await db.one('SELECT settings FROM chat_settings WHERE user_id = ?', [userId]);
  const s = (row && store.json(row.settings)) || {};
  return { ...DEFAULT_SETTINGS, ...s, voice: { ...DEFAULT_SETTINGS.voice, ...(s.voice || {}) } };
}

function cleanSettings(patch) {
  const out = {};
  for (const k of BOOLS) if (patch[k] !== undefined) out[k] = Boolean(patch[k]);
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (patch[k] === undefined) continue;
    if (!allowed.includes(patch[k])) v.fail(k, 'Choose one of the listed options.');
    out[k] = patch[k];
  }
  if (patch.defaultModel !== undefined) out.defaultModel = patch.defaultModel ? String(patch.defaultModel).slice(0, 64) : null;
  if (patch.voice && typeof patch.voice === 'object') {
    out.voice = {};
    for (const [k, allowed] of Object.entries(VOICE)) {
      if (patch.voice[k] === undefined) continue;
      const val = k === 'readAloudRate' ? Number(patch.voice[k]) : patch.voice[k];
      if (!allowed.includes(val)) v.fail(`voice.${k}`, 'Choose one of the listed options.');
      out.voice[k] = val;
    }
    if (patch.voice.autoSend !== undefined) out.voice.autoSend = Boolean(patch.voice.autoSend);
  }
  return out;
}

r.get('/chat/settings', requireUser, async (req) => [200, { settings: await loadSettings(req.user.id) }]);

r.patch('/chat/settings', requireUser, async (req) => {
  const cur = await loadSettings(req.user.id);
  const p = cleanSettings(req.body);
  const next = { ...cur, ...p, voice: { ...cur.voice, ...(p.voice || {}) } };
  await db.query('INSERT INTO chat_settings (user_id, settings) VALUES (?, ?) ON DUPLICATE KEY UPDATE settings = VALUES(settings)', [req.user.id, JSON.stringify(next)]);
  return [200, { settings: next }];
});

r.get('/chat/stats', requireUser, async (req) => {
  const c = await db.one('SELECT COUNT(*) AS n FROM chat_conversations WHERE user_id = ?', [req.user.id]);
  const m = await db.one("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS bytes FROM chat_messages WHERE user_id = ? AND role <> 'event'", [req.user.id]);
  const f = await db.one('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM chat_attachments WHERE user_id = ?', [req.user.id]);
  return [200, { conversations: Number(c.n), messages: Number(m.n), files: Number(f.n), bytes: Number(m.bytes) + Number(f.bytes), where: 'Your Colon account' }];
});

/* ---------- Guest (and temporary) chat: streams a reply, saves nothing ---------- */
// Signed-out visitors chat here with a lower daily limit. Signed-in users with "Save chat history"
// off use it too (their own limit). The app keeps the conversation in memory for that tab only.
function guestOrigin(req) {
  const origin = req.headers.origin;
  if (config.isProd && (!origin || !config.allowedOrigins.includes(origin))) deny(403, 'csrf', 'Request blocked.');
}

function guestCookie(gid) {
  const parts = [`colon_gid=${gid}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${365 * 86400}`];
  if (config.isProd) parts.push('Secure');
  if (config.auth.cookieDomain) parts.push(`Domain=${config.auth.cookieDomain}`);
  return parts.join('; ');
}

function cleanGuestHistory(list) {
  if (!Array.isArray(list) || !list.length) v.fail('messages', 'Type a message first.');
  const msgs = list.slice(-40).map((m) => {
    const role = m && m.role === 'assistant' ? 'assistant' : 'user';
    const content = String((m && m.content) || '').slice(0, MAX_CONTENT);
    const files = (Array.isArray(m && m.attachments) ? m.attachments : []).slice(0, 5).map(a => ({
      name: String((a && a.name) || 'file').slice(0, 180), kind: ['pdf', 'doc', 'text', 'audio', 'image'].includes(a && a.kind) ? a.kind : 'text',
      text: String((a && a.text) || '').slice(0, 24000), pages: Number(a && a.pages) || undefined, note: a && a.note ? String(a.note).slice(0, 200) : undefined,
    }));
    return { role, content, files };
  });
  const last = msgs[msgs.length - 1];
  if (last.role !== 'user' || (!last.content.trim() && !last.files.length)) v.fail('messages', 'Type a message first.');
  return msgs;
}

r.post('/chat/guest', { bodyLimit: 1024 * 1024 }, guestOrigin, settings.feature('guestChat', { guestsOnly: true }), limit('guest-chat', 20, 60), async (req, res) => {
  const history = cleanGuestHistory(req.body.messages);
  const last = history[history.length - 1];
  if (req.user && Array.isArray(req.body.attachment_ids) && req.body.attachment_ids.length) {
    const rows = await store.claimAttachments(req.user.id, req.body.attachment_ids, null, null);
    const lists = await files.forModel(req.user.id, [rows.map(store.attachmentOut)], 0);
    last.files = last.files.concat(lists[0]);
  } else if (last.files.some(f => f.kind === 'image')) {
    v.fail('attachments', 'Log in to ask Colon about images.');
  }
  if (!req.user && !limits.validGid(req.cookies.colon_gid)) {
    // Anonymous browser id for the guest daily limit (no account, no personal data).
    req.cookies.colon_gid = store.newId() + store.newId();
    res.setHeader('Set-Cookie', guestCookie(req.cookies.colon_gid));
  }
  const mode = store.MODES.includes(req.body.mode) ? req.body.mode : 'general';
  const chosen = req.user ? req.user.language : (v.LANGS.includes(req.body.language) ? req.body.language : 'en');
  const model = req.body.model ? String(req.body.model).slice(0, 64) : null;
  let msg = null;
  await respond({
    req, res, mode, model, language: replyLanguage(chosen, last.content), name: req.user ? req.user.name : '',
    history: buildMessages(history), counters: await limits.resolveCounters(req, mode),
    webSearch: wantsWeb(mode), searchText: last.content, searchPrevious: previousUserText(history),
    store: {
      async start() {
        msg = { id: store.newId(), role: 'assistant', content: '', sources: [], status: 'streaming', mode, model, created_at: new Date().toISOString(), temporary: true };
        return msg;
      },
      async finish({ content, status, error, sources, web }) {
        Object.assign(msg, { content: content || '', status, completed_at: new Date().toISOString() });
        if (error) msg.error = error;
        if (web) { msg.sources = sources || []; msg.web = { ok: Boolean(web.ok), provider: web.provider || null }; }
        return msg;
      },
    },
  });
});

module.exports = r;
module.exports.loadSettings = loadSettings;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
