// Workspace chat (v0.26.0, Workspace step 2): the user describes the site, Colon writes or edits its files.
//
//   send()     saves the user's message and starts the reply in the background (a whole site can take a minute
//              or two, longer than a phone's request should wait), then answers at once.
//   history()  the conversation plus { working: true } while a reply is being written; the app polls it.
//   reply      the model gets the Workspace rules, the site's files (prompt.js) and the last few messages; its
//              answer is parsed (edits.js) and applied as ONE version (index.js applyOps), so the reply's Undo
//              restores version_before. Any failure becomes an assistant message with error: true; nothing changes.
// One reply at a time per workspace. The generate/record/limits pieces are passed in (handlers.js), so tests run
// without a model, a database or billing.
const edits = require('./edits');
const prompt = require('./prompt');

const MAX_MESSAGE = 4000;
const HISTORY = 8;          // earlier messages the model sees
const STALE_MS = 5 * 60 * 1000;   // a reply not written by then is treated as lost (the process died)
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const FRIENDLY = {
  no_provider: 'Colon isn’t connected to an AI provider yet.',
  provider_down: 'Colon couldn’t reach an AI provider right now. Please try again in a moment.',
  edit_failed: 'Colon’s change didn’t fit the current files, so nothing was changed. Try asking again.',
  empty: 'Colon didn’t send any changes. Try describing what you want a little differently.',
};

const msgOut = (m) => ({ id: Number(m.id), role: m.role, content: m.content, error: Boolean(Number(m.error)),
  changes: m.changes ? (typeof m.changes === 'string' ? JSON.parse(m.changes) : m.changes) : [],
  version_before: m.version_before == null ? null : Number(m.version_before),
  version_after: m.version_after == null ? null : Number(m.version_after), created_at: m.created_at });

// What an earlier assistant message looked like to the model: its note plus the files it touched.
const asHistory = (m) => ({ role: m.role, content: m.role === 'assistant' && m.changes.length
  ? `${m.content}\n(Changed: ${m.changes.map((c) => `${c.op} ${c.path}`).join(', ')})` : m.content });

function createChat({ engine, deps }) {
  const store = engine.store;
  const running = new Map();   // workspace id -> { started }

  // v0.28.0: "working" also comes from the database (the newest message is the user's and under STALE_MS old),
  // because cPanel's Passenger runs several API processes: the poll can reach a process other than the one
  // writing the reply, whose in-memory map is empty. Without this the app stopped polling and showed no reply.
  const pending = (msgs) => {
    const last = msgs[msgs.length - 1];
    return Boolean(last && last.role === 'user' && Date.now() - new Date(last.created_at).getTime() < STALE_MS);
  };
  async function history(u, id) {
    const w = await engine.owned(u, id);
    const messages = (await store.messages(w.id, 100)).map(msgOut);
    return { messages, working: running.has(w.id) || pending(messages), version: Number(w.version) };
  }

  async function reply(u, w, text, ctx) {
    const bundle = await engine.bundle(u, w.id);
    const files = bundle.files.map((f) => ({ path: f.path, size: f.size, text: f.encoding === 'utf8',
      content: f.encoding === 'utf8' ? f.content : undefined }));
    const earlier = (await store.messages(w.id, HISTORY + 1)).map(msgOut).filter((m) => !m.error);
    const messages = earlier.map(asHistory);
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user' || last.content !== text) messages.push({ role: 'user', content: text });
    const r = await deps.generate({ mode: 'developer', language: 'en', messages, taskText: text,
      context: prompt.context({ files, message: text, title: w.title }), routing: ctx.routing, signal: ctx.signal });
    if (ctx.record) await Promise.resolve(ctx.record(r)).catch(() => {});
    const parsed = edits.parse(r.text);
    if (!parsed.ops.length && !parsed.note) throw err(502, 'empty', FRIENDLY.empty);
    const applied = await engine.applyOps(u, w.id, parsed.ops, `Chat: ${text}`);
    const note = parsed.note || (applied.changes.length ? 'Done.' : '');
    await store.addMessage(w.id, { role: 'assistant', content: note || FRIENDLY.empty, changes: applied.changes,
      version_before: applied.changes.length ? applied.before : null,
      version_after: applied.changes.length ? applied.version : null });
  }

  // send(u, id, { message }) -> { message, working: true }; the reply lands in history() when it's ready.
  async function send(u, id, body = {}, ctx = {}) {
    const w = await engine.owned(u, id);
    const text = String(body.message == null ? '' : body.message).trim();
    if (!text) throw err(422, 'invalid', 'Tell Colon what to build or change.');
    if (text.length > MAX_MESSAGE) throw err(422, 'invalid', `Keep a message under ${MAX_MESSAGE} characters.`);
    if (running.has(w.id) || pending((await store.messages(w.id, 1)).map(msgOut))) {
      throw err(409, 'busy', 'Colon is still working on your last message.');
    }
    running.set(w.id, { started: Date.now() });
    const mid = await store.addMessage(w.id, { role: 'user', content: text });
    const job = (async () => {
      try {
        await reply(u, w, text, ctx);
      } catch (e) {
        if (ctx.onFail) await ctx.onFail(e);
        const known = FRIENDLY[e.code] || (e.status && e.status < 500 && e.message);
        if (!known && deps.log) deps.log.error('workspace_chat_failed', { err: e.message, code: e.code });
        await store.addMessage(w.id, { role: 'assistant', error: true, content: known
          || 'Something went wrong while Colon was building. Nothing was changed; please try again.' })
          .catch(() => {});
      } finally {
        running.delete(w.id);
      }
    })();
    if (ctx.wait) await job;   // tests
    return { message: { id: Number(mid), role: 'user', content: text }, working: true };
  }

  return { send, history, _running: running };
}

module.exports = { createChat, msgOut, MAX_MESSAGE, FRIENDLY };
