// Memory (v0.15.0, Blueprint step B9): what Colon remembers about a signed-in user, with their consent.
//
//   consent    OFF by default (opt-in). Until the user turns it on in Settings › Memory nothing is saved from chat
//              and nothing is added to a reply's context. Turning it off stops both at once; saved memories stay
//              until the user deletes them (they can still view, edit and delete them).
//   saving     only what the user writes in Settings › Memory or asks for in chat ("remember that …"). Colon never
//              saves anything on its own (no model-suggested memories).
//   scopes     user (every chat) · project (chats in that project) · task (one chat).
//   retrieval  retrieve.js: keyword overlap + recency, within MEMORY_TOKEN_BUDGET tokens. No vector database.
//   ownership  every store statement is scoped to the user (store.js); another user's id answers 404.
const config = require('../../config');
const { sqlStore, memoryStore } = require('./store');
const retrieve = require('./retrieve');
const log = require('../../shared/logger');

const SCOPES = ['user', 'project', 'task'];
const MAX_CONTENT = 1000;
const NOTICE = 'When memory is on, Colon keeps the notes you save here (or ask it to remember in a chat) and uses '
  + 'the relevant ones in its replies. Nothing is saved without you asking. You can edit or delete any note, or '
  + 'turn memory off, at any time.';

const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });
const notFound = () => err(404, 'not_found', 'This memory no longer exists.');

function memOut(m) {
  return { id: String(m.id), scope: m.scope, content: m.content, source: m.source, project_id: m.project_id || null,
    conversation_id: m.conversation_id || null, created_at: m.created_at, updated_at: m.updated_at };
}

function cleanContent(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw err(422, 'invalid', 'Write something to remember.', 'content');
  if (s.length > MAX_CONTENT) throw err(422, 'invalid', `A memory can be up to ${MAX_CONTENT} characters.`, 'content');
  return s;
}

// "remember that I'm vegetarian" / "Remember: my exam is in June" -> the note; questions and "remember when…" -> null.
function rememberCommand(text) {
  const t = String(text || '').trim();
  if (!t || t.length > MAX_CONTENT + 40 || /\?\s*$/.test(t)) return null;
  const m = /^(?:please\s+)?remember(?:\s+(?:this|that))?\s*[:,\-–]?\s+([\s\S]{3,})$/i.exec(t);
  if (!m || /^(when|how|what|who|why|the time)\b/i.test(m[1])) return null;
  return m[1].replace(/\s+/g, ' ').trim().replace(/^that\s+/i, '');
}

function create({ store = sqlStore(), cfg = config.memory } = {}) {
  const user = (u) => { if (!u || !u.id) throw err(401, 'unauthorized', 'Log in to use memory.'); return u.id; };

  async function enabled(userId) { const c = await store.consent(userId); return Boolean(c && c.enabled); }

  async function status(u) {
    const id = user(u);
    const c = await store.consent(id);
    return { enabled: Boolean(c && c.enabled), chosen: Boolean(c), changed_at: c ? c.changed_at : null,
      count: await store.count(id), max: cfg.maxItems, token_budget: cfg.tokenBudget, notice: NOTICE };
  }

  async function setConsent(u, on) {
    if (typeof on !== 'boolean') throw err(422, 'invalid', 'Send enabled: true or false.', 'enabled');
    await store.setConsent(user(u), on);
    return status(u);
  }

  async function list(u, { projectId } = {}) {
    return (await store.list(user(u), { projectId: projectId || null })).map(memOut);
  }

  // Resolves scope + ids to what is stored, checking the project or chat belongs to this user.
  async function placement(id, b) {
    const scope = b.scope == null ? (b.project_id ? 'project' : 'user') : b.scope;
    if (!SCOPES.includes(scope)) throw err(422, 'invalid', 'Choose a scope: user, project or task.', 'scope');
    if (scope === 'user') return { scope, project_id: null, conversation_id: null };
    if (scope === 'project') {
      if (!b.project_id || !(await store.ownsProject(id, String(b.project_id)))) {
        throw err(404, 'not_found', 'This project no longer exists.');
      }
      return { scope, project_id: String(b.project_id), conversation_id: null };
    }
    const conv = b.conversation_id ? await store.conversationProject(id, String(b.conversation_id)) : null;
    if (!conv) throw err(404, 'not_found', 'This conversation no longer exists.');
    return { scope, project_id: conv.project_id, conversation_id: String(b.conversation_id) };
  }

  async function add(u, b = {}, { source = 'settings' } = {}) {
    const id = user(u);
    if (!(await enabled(id))) throw err(409, 'memory_off', 'Turn memory on in Settings › Memory first.');
    const content = cleanContent(b.content);
    const where = await placement(id, b);
    if ((await store.count(id)) >= cfg.maxItems) {
      throw err(409, 'memory_full', `You have ${cfg.maxItems} memories, the most Colon keeps. Delete some first.`);
    }
    const newId = await store.insert({ user_id: id, ...where, content,
      source: source === 'chat' ? 'chat' : 'settings' });
    return memOut(await store.get(id, newId));
  }

  async function edit(u, memId, b = {}) {
    const id = user(u);
    const content = cleanContent(b.content);
    if (!(await store.update(id, String(memId), { content }))) throw notFound();
    return memOut(await store.get(id, String(memId)));
  }

  async function remove(u, memId) { if (!(await store.remove(user(u), String(memId)))) throw notFound(); return true; }
  async function clear(u) { return store.removeAll(user(u)); }

  // The memory block for one reply, or '' (no user, memory off, nothing relevant, or any error: never fatal).
  async function contextFor({ user: u, query = '', projectId = null, conversationId = null, budget } = {}) {
    if (!u || !u.id) return { block: '', ids: [] };
    try {
      if (!(await enabled(u.id))) return { block: '', ids: [] };
      const rows = await store.candidates(u.id, { projectId, conversationId });
      const picked = retrieve.select(rows, { query, budget: budget != null ? budget : cfg.tokenBudget });
      return { block: retrieve.block(picked), ids: picked.map((m) => String(m.id)) };
    } catch (e) {
      log.warn('memory_context_failed', { err: String(e.message || '').slice(0, 160) });
      return { block: '', ids: [] };
    }
  }

  // Chat: saves "remember that …" when memory is on. -> the saved memory, or null (not a command / memory off).
  async function fromChat({ user: u, text, projectId = null, conversationId = null }) {
    const note = rememberCommand(text);
    if (!note || !u || !u.id) return null;
    try {
      if (!(await enabled(u.id))) return null;
      return await add(u, { content: note, scope: projectId ? 'project' : 'user', project_id: projectId,
        conversation_id: conversationId }, { source: 'chat' });
    } catch (e) {
      log.warn('memory_save_failed', { code: e.code, err: String(e.message || '').slice(0, 160) });
      return null;
    }
  }

  return { status, setConsent, list, add, edit, remove, clear, contextFor, fromChat, enabled, store };
}

let shared = null;
const instance = () => (shared || (shared = create()));

module.exports = {
  create, instance, memoryStore, retrieve, rememberCommand, SCOPES, NOTICE, MAX_CONTENT,
  count: (userId) => instance().store.count(userId),
  contextFor: (o) => instance().contextFor(o),
  fromChat: (o) => instance().fromChat(o),
  handlers: require('./handlers'),
};
