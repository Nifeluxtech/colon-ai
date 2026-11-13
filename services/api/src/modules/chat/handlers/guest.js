// Chat: guest (and temporary) chat stream (handlers for src/http/routes/chat/guest.js).

const config = require('../../../config');
const v = require('../../../shared/validate');
const limits = require('../../ai').limits;
const { replyLanguage } = require('../../ai').prompts;
const store = require('../store');
const files = require('../files');
const { forMode } = require('../context');
const { respond } = require('../reply');
const safety = require('../../safety');
const { MAX_CONTENT, wantsWeb, previousUserText } = require('./chat-common');

/* ---------- Guest (and temporary) chat: streams a reply, saves nothing ---------- */
// Signed-out visitors chat here with a lower daily limit. Signed-in users with "Save chat history"
// off use it too (their own limit). The app keeps the conversation in memory for that tab only.
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
      name: String((a && a.name) || 'file').slice(0, 180), kind: ['pdf', 'doc', 'text', 'audio', 'image'].includes(a
        && a.kind) ? a.kind : 'text',
      text: String((a && a.text) || '').slice(0, 24000), pages: Number(a && a.pages) || undefined, note: a && a.note
        ? String(a.note).slice(0, 200) : undefined,
    }));
    return { role, content, files };
  });
  const last = msgs[msgs.length - 1];
  if (last.role !== 'user' || (!last.content.trim() && !last.files.length)) v.fail('messages', 'Type a message first.');
  return msgs;
}

// POST /chat/guest
const postChatGuest = async (req, res) => {
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
  const guard = safety.collector();
  const built = forMode(history, { mode, guard, message: last.content });   // Developer mode: project context
  await respond({
    req, res, mode, model, language: replyLanguage(chosen, last.content), name: req.user ? req.user.name : '',
    route: 'chat.guest', guard, userText: last.content, project: built.project,
    history: built.messages, counters: await limits.resolveCounters(req, mode),
    webSearch: wantsWeb(mode), searchText: last.content, searchPrevious: previousUserText(history),
    store: {
      async start() {
        msg = { id: store.newId(), role: 'assistant', content: '', sources: [], status: 'streaming', mode, model,
          created_at: new Date().toISOString(), temporary: true };
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
};

module.exports = { postChatGuest };
