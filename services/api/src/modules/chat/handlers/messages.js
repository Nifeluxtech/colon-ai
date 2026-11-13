// Chat: messages (streamed replies), notes and feedback (handlers for src/http/routes/chat/messages.js).

const db = require('../../../db');
const v = require('../../../shared/validate');
const limits = require('../../ai').limits;
const settings = require('../../../shared/settings');
const { replyLanguage } = require('../../ai').prompts;
const store = require('../store');
const files = require('../files');
const { forMode } = require('../context');
const { respond, stopLocal } = require('../reply');
const safety = require('../../safety');
const { MAX_CONTENT, wantsWeb, previousUserText, loadSettings, fileNames } = require('./chat-common');

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
        ('UPDATE chat_messages SET content = ?, status = ?, error = ?, provider = ?, provider_model = ?, '
          + 'completed_at = UTC_TIMESTAMP(3) WHERE id = ?'),
        [content || '', status, error ? JSON.stringify(error) : null, providerId || null, providerModel || null, id]
      );
      // Research mode: the cited sources and how the search went (migration 0006). Separate, so a database
      // that hasn't run 0006 yet still saves the answer itself.
      if (web) {
        await db.query('UPDATE chat_messages SET sources = ?, web_search = ? WHERE id = ?', [JSON.stringify(sources
          || []), JSON.stringify(web), id])
          .catch(() => db.query('UPDATE chat_messages SET sources = ? WHERE id = ?', [JSON.stringify(sources || []),
            id]).catch(() => {}));
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
  const turns = all.slice(0, end + 1).filter(m => m.role === 'user' || (m.role === 'assistant'
    && (m.status === 'complete' || m.status === 'stopped') && m.content));
  const latest = turns.length - 1;
  const fileLists = await files.forModel(req.user.id, turns.map(m => m.attachments || []), latest);
  return turns.map((m, i) => ({ role: m.role, content: m.content, files: fileLists[i] }));
}

async function seqOf(id) {
  const row = await db.one('SELECT seq FROM chat_messages WHERE id = ?', [id]);
  return row ? row.seq : null;
}

async function streamFor(req, res, conv, userMsg, { version = 1, onOpen, route = 'chat.send' } = {}) {
  const counters = await limits.resolveCounters(req, conv.mode);
  const guard = safety.collector();   // injection flags found in attached files (logged as safety events)
  return historyFor(req, conv, userMsg.id).then(history => {
    // Developer mode: the project context comes from every file attached so far in this conversation.
    const built = forMode(history, { mode: conv.mode, guard, message: userMsg.content });
    return respond({
      req, res, mode: conv.mode, model: conv.model, language: replyLanguage(req.user.language, userMsg.content),
        name: req.user.name, route, guard, userText: userMsg.content, project: built.project,
      attachments: fileNames((history[history.length - 1] || {}).files),
      history: built.messages, counters, store: persistedStore(conv, { version }), onOpen,
      webSearch: wantsWeb(conv.mode), searchText: userMsg.content, searchPrevious: previousUserText(history),
    });
  });
}

function cleanContent(raw) {
  const content = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
  if (content.length > MAX_CONTENT) v.fail('content', `Messages can be up to ${MAX_CONTENT} characters.`);
  return content.trim();
}

/* ---------- Feedback ---------- */
const REASONS = ['Not accurate', 'Not helpful', 'Wrong language', 'Unsafe or harmful', 'Too long', 'Other'];

// POST /conversations/:id/messages
const postConversationsByIdMessages = async (req, res) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const content = cleanContent(req.body.content);
  const ids = Array.isArray(req.body.attachment_ids) ? req.body.attachment_ids : [];
  if (!content && !ids.length) v.fail('content', 'Type a message first.');
  const atts = await store.claimAttachments(req.user.id, ids, conv, null);
  const userMsg = await store.insertMessage(conv, { role: 'user', content, attachments: atts.map(
    store.attachmentOut) });
  if (atts.length) await store.claimAttachments(req.user.id, ids, conv, userMsg.id);
  const title = conv.title === 'New chat' ? store.titleFrom(content || (atts[0] && atts[0].name)) : null;
  await store.touch(conv, { title, preview: content || (atts[0] && atts[0].name) });
  const fresh = await store.getConv(req.user.id, conv.id);
  await streamFor(req, res, fresh, userMsg, { onOpen: (sse) => sse.send('user', { message: userMsg,
    conversation: store.convOut(fresh) }) });
};

// POST /conversations/:id/messages/:mid/regenerate
const postConversationsByIdMessagesByMidRegenerate = async (req, res) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const all = await store.messages(conv.id);
  const idx = all.findIndex(m => m.id === req.params.mid && m.role === 'assistant');
  // An error card the app made itself (no saved message) retries the latest question.
  const before = idx > -1 ? all.slice(0, idx) : all;
  const userMsg = [...before].reverse().find(m => m.role === 'user');
  if (!userMsg) v.fail('message', 'There’s nothing to regenerate yet.');
  const version = idx > -1 ? (all[idx].version || 1) + 1 : 1;
  await db.query('DELETE FROM chat_messages WHERE conversation_id = ? AND seq > ?', [conv.id, await seqOf(userMsg.id)]);
  await streamFor(req, res, conv, userMsg, { version, route: 'chat.regenerate' });
};

// POST /conversations/:id/messages/:mid/edit
const postConversationsByIdMessagesByMidEdit = async (req, res) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const msg = await store.getMessage(conv.id, req.params.mid);
  if (!msg || msg.role !== 'user') throw store.notFound('This message no longer exists.');
  const content = cleanContent(req.body.content);
  if (!content && !(msg.attachments || []).length) v.fail('content', 'Type a message first.');
  await db.query('UPDATE chat_messages SET content = ? WHERE id = ?', [content, msg.id]);
  await db.query('DELETE FROM chat_messages WHERE conversation_id = ? AND seq > ?', [conv.id, await seqOf(msg.id)]);
  await store.touch(conv, { preview: content });
  const userMsg = await store.getMessage(conv.id, msg.id);
  await streamFor(req, res, conv, userMsg, { route: 'chat.edit', onOpen: (sse) => sse.send('user', {
    message: userMsg, conversation: store.convOut(conv) }) });
};

// POST /conversations/:id/messages/:mid/stop
const postConversationsByIdMessagesByMidStop = async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const mid = String(req.params.mid);
  if (!stopLocal(mid)) {
    // Another worker holds the stream: flag it; that worker checks every 2 seconds and stops.
    await db.query(
      "UPDATE chat_messages SET status = 'stopped' WHERE id = ? AND conversation_id = ? AND status = 'streaming'",
      [mid, conv.id]);
  }
  return [200, { ok: true }];
};

// AI Browse summaries and other assistant notes written by the app (and, Phase 10, the user's browser instructions).
// POST /conversations/:id/notes
const postConversationsByIdNotes = async (req) => {
  const conv = await store.getConv(req.user.id, req.params.id);
  const content = String(req.body.content || '').slice(0, 60000).trim();
  if (!content) v.fail('content', 'The note is empty.');
  const sources = (Array.isArray(req.body.sources) ? req.body.sources : []).slice(0, 20).map((s, i) => ({
    n: Number(s.n) || i + 1, title: String(s.title || '').slice(0, 200), url: /^https?:\/\//i.test(String(s.url || ''))
      ? String(s.url).slice(0, 2000) : '', snippet: String(s.snippet || '').slice(0, 500),
  })).filter(s => s.url);
  const origin = req.body.origin === 'browse' ? 'browse' : 'note';
  // Phase 10: an instruction the user typed for the chat's browser ("open google.com", "scroll down") is kept in the
  // thread as the user's own message (origin browse) before Saga's reply note.
  const role = req.body.role === 'user' && origin === 'browse' ? 'user' : 'assistant';
  const msg = await store.insertMessage(conv, { role, content, sources: role === 'user' ? [] : sources,
    status: 'complete', origin });
  await store.touch(conv, { preview: content, title: conv.title === 'New chat' && req.body.title ? store.titleFrom(
    req.body.title) : null });
  return [201, { message: msg }];
};

// POST /messages/:id/feedback
const postMessagesByIdFeedback = async (req) => {
  const m = await db.one(
    `SELECT m.id, m.conversation_id, m.mode, m.provider, m.provider_model, m.role FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id WHERE m.id = ? AND c.user_id = ?`,
         [String(req.params.id), req.user.id]);
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
    `INSERT INTO chat_feedback (message_id, user_id, conversation_id, rating, reason, comment, mode, provider,
      provider_model, shareable, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), reason = VALUES(reason), comment = VALUES(comment),
       shareable = VALUES(shareable), updated_at = UTC_TIMESTAMP(3)`,
    [m.id, req.user.id, m.conversation_id, rating, reason, comment, m.mode, m.provider, m.provider_model,
      settings.shareFeedback === false ? 0 : 1]
  );
  return [200, { ok: true, feedback: { rating, reason, comment } }];
};

module.exports = { postConversationsByIdMessages, postConversationsByIdMessagesByMidRegenerate,
  postConversationsByIdMessagesByMidEdit, postConversationsByIdMessagesByMidStop, postConversationsByIdNotes,
  postMessagesByIdFeedback };
