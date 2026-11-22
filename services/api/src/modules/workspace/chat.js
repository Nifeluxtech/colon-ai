// Workspace chat (v0.26.0, Workspace step 2): the user describes the site, Colon writes or edits its files.
//
//   send()     saves the user's message and starts the reply in the background (a whole site can take a minute
//              or two, longer than a phone's request should wait), then answers at once.
//   history()  the conversation plus { working: true } while a reply is being written; the app polls it.
//   reply      the model gets the Workspace rules, the site's files (prompt.js) and the last few messages; its
//              answer is parsed (edits.js) and applied as ONE version (index.js applyOps), so the reply's Undo
//              restores version_before. Any failure becomes an assistant message with error: true; nothing changes.
// One build at a time per workspace; a message sent mid-build gets a quick answer and changes queue (side.js,
// v0.27.2). The generate/record/limits pieces are passed in (handlers.js), so tests run
// without a model, a database or billing.
const edits = require('./edits');
const prompt = require('./prompt');
const sideTalk = require('./side');

const MAX_MESSAGE = 4000;
const HISTORY = 8;          // earlier messages the model sees
const STALE_MS = 5 * 60 * 1000;   // a reply not written by then is treated as lost (the process died)
const QUEUE_STALE_MS = 15 * 60 * 1000;   // the same for a build that waited in the queue (v0.27.2)
const SIDE_STALE_MS = 2 * 60 * 1000;     // ... and for a quick answer to a mid-build message
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
  version_after: m.version_after == null ? null : Number(m.version_after),
  steps: m.steps ? (typeof m.steps === 'string' ? JSON.parse(m.steps) : m.steps) : [], kind: m.kind || null,
  created_at: m.created_at });
const young = (m, ms) => Date.now() - new Date(m.created_at).getTime() < ms;

// v0.27.2: the live step list for one reply. Each change is saved on the user's message (any API process can then
// answer the poll); writes are chained so they land in order, and a failed write never stops the reply.
function tracker(save) {
  const steps = [], t0 = Date.now();
  let chain = Promise.resolve();
  const flush = () => { const copy = steps.map((x) => ({ ...x })); chain = chain.then(() => save(copy)).catch(() => {});
    return chain; };
  const finish = (state, detail) => {
    const cur = steps[steps.length - 1];
    if (cur && cur.state === 'run') { cur.state = state; cur.ms = Date.now() - t0 - cur.start; }
    if (cur && detail) cur.detail = String(detail).slice(0, 120);
  };
  return {
    start(label, detail) { finish('done'); steps.push({ label, state: 'run', start: Date.now() - t0,
      ...(detail ? { detail } : {}) }); return flush(); },
    done(detail) { finish('done', detail); return flush(); },
    fail(detail) { finish('fail', detail); return flush(); },
    add(label, detail) { finish('done'); steps.push({ label, state: 'done', start: Date.now() - t0, ms: 0,
      ...(detail ? { detail } : {}) }); },
    list: () => steps.map((x) => ({ ...x })),
  };
}
const kb = (n) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);
const VERB = { created: 'Created', edited: 'Edited', deleted: 'Deleted' };

// What an earlier assistant message looked like to the model: its note plus the files it touched.
const asHistory = (m) => ({ role: m.role, content: m.role === 'assistant' && m.changes.length
  ? `${m.content}\n(Changed: ${m.changes.map((c) => `${c.op} ${c.path}`).join(', ')})` : m.content });

function createChat({ engine, deps }) {
  const store = engine.store;
  const running = new Map();   // workspace id -> { started }

  // v0.28.0: "working" also comes from the database (the newest message is the user's and under STALE_MS old),
  // because cPanel's Passenger runs several API processes: the poll can reach a process other than the one
  // writing the reply, whose in-memory map is empty. Without this the app stopped polling and showed no reply.
  // v0.27.2: a build running or queued (kind), or a mid-build question still waiting for its quick answer.
  const pending = (msgs) => {
    const last = msgs[msgs.length - 1];
    if (msgs.some((m) => m.role === 'user' && (m.kind === 'running' || m.kind === 'queued')
      && young(m, QUEUE_STALE_MS))) return true;
    if (!last || last.role !== 'user') return false;
    return last.kind === 'side' ? young(last, SIDE_STALE_MS) : !last.kind && young(last, STALE_MS);
  };
  async function history(u, id) {
    const w = await engine.owned(u, id);
    const messages = (await store.messages(w.id, 100)).map(msgOut);
    return { messages, working: running.has(w.id) || pending(messages), version: Number(w.version),
      now: new Date().toISOString(), instructions: w.instructions || '',
      reference: w.ref_url ? { url: w.ref_url, files: Number(w.ref_files) || 0 } : null };
  }

  async function reply(u, w, m, ctx, t) {
    const text = m.content;
    await t.start('Reading your site’s files');
    const bundle = await engine.bundle(u, w.id);
    const files = bundle.files.map((f) => ({ path: f.path, size: f.size, text: f.encoding === 'utf8',
      content: f.encoding === 'utf8' ? f.content : undefined }));
    await t.done(`${files.length} file${files.length === 1 ? '' : 's'}, ${kb(files.reduce((n, f) => n
      + (Number(f.size) || 0), 0))}`);
    // The build conversation only: no mid-build chatter, no other queued requests, this message last.
    const earlier = (await store.messages(w.id, HISTORY * 3)).map(msgOut).filter((x) => !x.error && x.id !== m.id
      && x.kind !== 'side' && x.kind !== 'queued' && x.kind !== 'running').slice(-HISTORY);
    const messages = earlier.map(asHistory);
    messages.push({ role: 'user', content: text });
    await t.start('Thinking and writing the code');
    let r;
    try {
      const ref = w.ref_url ? await store.reference(w.id) : null;
      r = await deps.generate({ mode: 'developer', language: 'en', messages, taskText: text,
        context: prompt.context({ files, message: text, title: w.title, instructions: w.instructions,
          reference: ref }), routing: ctx.routing, signal: ctx.signal });
    } catch (e) { await t.fail('The AI provider didn’t answer'); throw e; }
    if (ctx.record) await Promise.resolve(ctx.record(r)).catch(() => {});
    const ok = (r.attempts || []).filter((a) => a.ok).pop();
    await t.done(ok && ok.model ? `${ok.model}` : '');
    await t.start('Checking the changes');
    const parsed = edits.parse(r.text);
    if (!parsed.ops.length && !parsed.note) { await t.fail('No changes in the reply'); throw err(502, 'empty',
      FRIENDLY.empty); }
    await t.done(`${parsed.ops.length} change${parsed.ops.length === 1 ? '' : 's'} planned`);
    let applied;
    try {
      applied = await engine.applyOps(u, w.id, parsed.ops, `Chat: ${text}`);
    } catch (e) { await t.start('Applying the changes'); await t.fail(e.message); throw e; }
    for (const c of applied.changes) t.add(`${VERB[c.op] || 'Edited'} ${c.path}`);
    if (applied.changes.length) t.add(`Saved version ${applied.version}`);
    const note = parsed.note || (applied.changes.length ? 'Done.' : '');
    await store.addMessage(w.id, { role: 'assistant', content: note || FRIENDLY.empty, changes: applied.changes,
      version_before: applied.changes.length ? applied.before : null,
      version_after: applied.changes.length ? applied.version : null, steps: t.list() });
  }

  // send(u, id, { message }) -> { message, working: true }; the reply lands in history() when it's ready.
  async function send(u, id, body = {}, ctx = {}) {
    const w = await engine.owned(u, id);
    const text = String(body.message == null ? '' : body.message).trim();
    if (!text) throw err(422, 'invalid', 'Tell Colon what to build or change.');
    if (text.length > MAX_MESSAGE) throw err(422, 'invalid', `Keep a message under ${MAX_MESSAGE} characters.`);
    const recent = (await store.messages(w.id, 30)).map(msgOut);
    if (running.has(w.id) || pending(recent)) return side(u, w, text, recent, ctx);
    const mid = await store.addMessage(w.id, { role: 'user', content: text, kind: 'running' });
    const job = drain(u, w, { id: Number(mid), content: text }, ctx);
    if (ctx.wait) await job;   // tests
    return { message: { id: Number(mid), role: 'user', content: text, kind: 'running' }, working: true };
  }

  async function build(u, w0, m, ctx0) {
    const t = tracker((steps) => store.setSteps(m.id, steps));
    // each build gets its own time limit, and the newest settings (instructions, reference) of the workspace
    const ctx = ctx0.signal ? { ...ctx0, signal: AbortSignal.timeout(240000) } : ctx0;
    const w = (await store.get(u.id, w0.id).catch(() => null)) || w0;
    try {
      await reply(u, w, m, ctx, t);
    } catch (e) {
      if (ctx.onFail) await ctx.onFail(e);
      const known = FRIENDLY[e.code] || (e.status && e.status < 500 && e.message);
      if (!known && deps.log) deps.log.error('workspace_chat_failed', { err: e.message, code: e.code });
      await store.addMessage(w.id, { role: 'assistant', error: true, steps: t.list(), content: known
        || 'Something went wrong while Colon was building. Nothing was changed; please try again.' })
        .catch(() => {});
    } finally {
      await store.setKind(m.id, 'done').catch(() => {});
    }
  }
  // Builds m, then every request queued meanwhile, oldest first, in this process.
  function drain(u, w, first, ctx) {
    running.set(w.id, { started: Date.now() });
    return (async () => {
      try {
        for (let m = first; m;) {
          await build(u, w, m, ctx);
          m = (await store.messages(w.id, 30)).map(msgOut).find((x) => x.role === 'user' && x.kind === 'queued'
            && young(x, QUEUE_STALE_MS));
          if (m) await store.setKind(m.id, 'running');
        }
      } finally {
        running.delete(w.id);
      }
    })();
  }

  // A message sent mid-build: a quick answer from the live steps; a change request joins the queue.
  async function side(u, w, text, recent, ctx) {
    const mid = Number(await store.addMessage(w.id, { role: 'user', content: text, kind: 'side' }));
    const users = recent.filter((x) => x.role === 'user');
    const cur = users.filter((x) => x.kind === 'running').pop() || users.filter((x) => x.kind !== 'side').pop();
    const job = (async () => {
      let ans;
      try {
        const r = await deps.generate({ mode: 'general', language: 'en', messages: [{ role: 'user', content: text }],
          taskText: text, routing: ctx.routing, signal: ctx.signal, context: sideTalk.context({ title: w.title,
            request: cur ? cur.content : '', steps: cur ? cur.steps : [], queued: users.filter((x) => x.kind
              === 'queued').map((x) => x.content) }) });
        if (ctx.record) await Promise.resolve(ctx.record(r)).catch(() => {});
        ans = sideTalk.parse(r.text);
      } catch (e) {   // never lose the message: build it next
        ans = { queue: true, text: 'I’ll look at this right after the current build.' };
      }
      if (ans.queue) await store.setKind(mid, 'queued');
      await store.addMessage(w.id, { role: 'assistant', content: ans.text, kind: 'side' });
      // The build may have ended while we answered; then nobody would pick the queue up.
      if (ans.queue && !running.has(w.id)) {
        const now = (await store.messages(w.id, 30)).map(msgOut);
        if (!now.some((x) => x.role === 'user' && x.kind === 'running' && young(x, QUEUE_STALE_MS))) {
          await store.setKind(mid, 'running');
          await drain(u, w, { id: mid, content: text }, ctx);
        }
      }
    })().catch((e) => { if (deps.log) deps.log.error('workspace_side_failed', { err: e.message }); });
    if (ctx.wait) await job;
    return { message: { id: mid, role: 'user', content: text, kind: 'side' }, working: true };
  }

  return { send, history, _running: running };
}

module.exports = { createChat, msgOut, MAX_MESSAGE, FRIENDLY };
