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
const triage = require('./triage');
const fast = require('./fast');
const exporter = require('./exporter');
const photos = require('./images');   // 0.38.0: photos sent with a message
const { tracker, skillStep } = require('./steps');

const MAX_MESSAGE = 4000;
const HISTORY = 8;          // earlier messages the model sees
const STALE_MS = 5 * 60 * 1000;   // a reply not written by then is treated as lost (the process died)
const QUEUE_STALE_MS = 15 * 60 * 1000;   // the same for a build that waited in the queue (v0.27.2)
const SIDE_STALE_MS = 2 * 60 * 1000;     // ... and for a quick answer to a mid-build message
// v0.27.3: a build gets 240 s; one with no progress for RUN_STALE_MS was lost (the process running it ended).
// v0.31.4: a running build beats every BEAT_MS, so one silent for RUN_STALE_MS really was lost.
const BUILD_MS = 240000, BEAT_MS = 30000, HOLD_MS = 270000;   // RUN_STALE_MS: chat-util.js
const STOP = new RegExp('^\\s*(please\\s+)?(stop|cancel|abort|halt)'
  + '(\\s+(it|that|this|now|please|the build|building|everything))*[\\s.!]*$', 'i');
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const FRIENDLY = {
  no_provider: 'Colon isn’t connected to an AI provider yet.',
  provider_down: 'Colon couldn’t reach an AI provider right now. Please try again in a moment.',
  edit_failed: 'Colon’s change didn’t fit the current files, so nothing was changed. Try asking again.',
  empty: 'Colon didn’t send any changes. Try describing what you want a little differently.',
  timeout: 'Colon took too long on this one, so nothing was changed. Try a smaller change, or send it again.',
};

const { msgOut, young, alive, kb, VERB, asHistory } = require('./chat-util');

function createChat({ engine, deps }) {
  const store = engine.store, pics = photos.create(deps);
  const running = new Map();   // workspace id -> { started }
  // v0.31.2: tab commands, quick answers, link reading and "stop" live in fast.js (size limit)
  const { readLinks, command, quick, stop } = fast.create({ engine, deps, store, running,
    drain: (...a) => drain(...a) });

  // v0.28.0: "working" also comes from the database (the newest message is the user's and under STALE_MS old),
  // because cPanel's Passenger runs several API processes: the poll can reach a process other than the one
  // writing the reply, whose in-memory map is empty. Without this the app stopped polling and showed no reply.
  // v0.27.2: a build running or queued (kind), or a mid-build question still waiting for its quick answer.
  const pending = (msgs) => {
    const last = msgs[msgs.length - 1];
    if (msgs.some((m) => m.role === 'user' && ((m.kind === 'running' && alive(m))
      || (m.kind === 'queued' && young(m, QUEUE_STALE_MS))))) return true;
    if (!last || last.role !== 'user') return false;
    return last.kind === 'side' || last.kind === 'quick' ? young(last, SIDE_STALE_MS)
      : !last.kind && young(last, STALE_MS);
  };
  async function history(u, id) {
    const w = await engine.owned(u, id);
    let messages = (await store.messages(w.id, 100)).map(msgOut);
    if (await recover(u, w, messages)) messages = (await store.messages(w.id, 100)).map(msgOut);
    return { messages, working: running.has(w.id) || pending(messages), version: Number(w.version),
      now: new Date().toISOString(), instructions: w.instructions || '',
      reference: w.ref_url ? { url: w.ref_url, files: Number(w.ref_files) || 0 } : null };
  }

  // v0.27.3: a build whose process ended (cPanel recycles API processes) is reported once, with nothing changed,
  // and the queue moves on. claimKind makes sure only one process does it. -> true when something changed.
  async function recover(u, w, messages) {
    if (running.has(w.id)) return false;
    let changed = false;
    for (const m of messages.filter((x) => x.role === 'user' && x.kind === 'running' && !alive(x))) {
      // v0.31.4: the first time, the build starts again by itself (marked so it is never retried twice)
      if (!m.steps.some((x) => x.retry) && (await store.claimKind(m.id, 'running', 'queued'))) {
        changed = true;
        await store.setSteps(m.id, [{ label: 'Starting again (the server restarted)', state: 'done', retry: true,
          start: 0, ms: 0, at: Date.now() }]);
        continue;
      }
      if (!(await store.claimKind(m.id, 'running', 'lost'))) continue;
      changed = true;
      await store.setSteps(m.id, m.steps.map((x) => (x.state === 'run' ? { ...x, state: 'fail',
        detail: 'Stopped: the server restarted' } : x)));
      await store.addMessage(w.id, { role: 'assistant', error: true, content: 'This build stopped before it '
        + 'finished (the server restarted), so nothing was changed. Send it again when you’re ready.' });
    }
    if (changed) await next(u, w, {});
    return changed;
  }
  // Starts the oldest queued request when no build is alive. -> the drain promise, or null
  async function next(u, w, ctx) {
    const now = (await store.messages(w.id, 30)).map(msgOut);
    if (now.some((x) => x.role === 'user' && x.kind === 'running' && alive(x))) return null;
    const q = now.find((x) => x.role === 'user' && x.kind === 'queued' && young(x, QUEUE_STALE_MS));
    if (!q || !(await store.claimKind(q.id, 'queued', 'running'))) return null;
    return drain(u, w, { id: q.id, content: q.content, steps: q.steps, images: q.images }, ctx);
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
      && x.kind !== 'side' && x.kind !== 'quick' && x.kind !== 'queued' && x.kind !== 'running').slice(-HISTORY);
    const messages = earlier.map(asHistory);
    messages.push({ role: 'user', content: await pics.content(u, m.images, text) });
    const links = await fast.linkStep(t, text, ctx.signal, readLinks, deps);   // v0.31.2
    const ref = w.ref_url ? await store.reference(w.id).catch(() => null) : null;
    const data = deps.dataInfo ? await deps.dataInfo(u, w.id).catch(() => null) : null;   // v0.29.0
    // v0.31.0: server access to a connected database / repository -> tool blocks and a short tool loop (tools.js)
    const kit = deps.tools && data ? await deps.tools(u, w.id, text, data).catch(() => null) : null;
    const extra = skillStep(t, text);   // v0.32.0: bundled skills that fit the request (modules/skills)
    const context = prompt.context({ files, message: text, title: w.title, instructions: w.instructions,
      reference: ref, data: kit ? { ...data, tools: kit.prompt } : data, links }) + extra;
    const gen = (extra) => {   // a hard limit too, in case a provider ignores the abort signal
      let timer;
      return Promise.race([deps.generate({ mode: 'developer', language: 'en', messages: messages.concat(extra),
        taskText: text, context, routing: ctx.routing, signal: ctx.signal, onThought: t.think }),
      new Promise((_, no) => { timer = setTimeout(() => no(err(504, 'timeout', FRIENDLY.timeout)), BUILD_MS + 10000);
        if (timer.unref) timer.unref(); })]).finally(() => clearTimeout(timer))
        .then((res) => { if (ctx.record) Promise.resolve(ctx.record(res)).catch(() => {}); return res; });
    };
    await t.start('Thinking and writing the code');
    let r;
    try {
      r = await gen([]);
      if (kit) r = await kit.loop(r, gen, t);
    } catch (e) {
      if (await stopped(m)) throw err(499, 'stopped', 'stopped');
      await t.fail(e.code === 'timeout' ? 'Took too long' : 'The AI provider didn’t answer'); throw e;
    }
    if (await stopped(m)) throw err(499, 'stopped', 'stopped');   // "stop" was sent while Colon was thinking
    const ok = (r.attempts || []).filter((a) => a.ok).pop();
    await t.done(ok && ok.model ? `${ok.model}` : '');
    await t.start('Checking the changes');
    const parsed = edits.parse(kit ? kit.strip(r.text) : r.text);
    if (!parsed.ops.length && !parsed.note) { await t.fail('No changes in the reply'); throw err(502, 'empty',
      FRIENDLY.empty); }
    await t.done(`${parsed.ops.length} change${parsed.ops.length === 1 ? '' : 's'} planned`);
    let applied;
    try {
      applied = await engine.applyOps(u, w.id, parsed.ops, `Chat: ${text}`);
    } catch (e) { await t.start('Applying the changes'); await t.fail(e.message); throw e; }
    for (const c of applied.changes) t.add(`${VERB[c.op] || 'Edited'} ${c.path}`);
    if (applied.changes.length) t.add(`Saved version ${applied.version}`);
    const did = kit ? await kit.after(r.text, t) : [];   // v0.31.0: database changes, commit, pull request, merge
    if (did.length) await t.done();
    const ex = exporter.stripMark(parsed.note);   // v0.31.0: "export my files as zip" -> a Download ZIP card
    if (ex.marked || exporter.wants(text)) {
      await t.start('Packing your files as a ZIP');
      const z = await engine.exportZip(u, w.id);
      await t.done(`${z.files} file${z.files === 1 ? '' : 's'}, ${kb(z.bytes)}`);
      did.push(exporter.line(z));
    }
    const note = [ex.text || (applied.changes.length || did.length ? 'Done.' : ''), ...did].filter(Boolean)
      .join('\n\n');
    await store.addMessage(w.id, { role: 'assistant', content: note || FRIENDLY.empty, changes: applied.changes,
      version_before: applied.changes.length ? applied.before : null,
      version_after: applied.changes.length ? applied.version : null, steps: t.list() });
  }

  // v0.31.4: { hold: true } keeps the request open while this process builds (up to HOLD_MS). The host stops API
  // processes that look idle, which killed builds running after the reply; an open request keeps it working.
  async function send(u, id, body = {}, ctx = {}) {
    const out = await start(u, id, body, ctx);
    const job = body.hold && running.has(out.wsId) ? running.get(out.wsId).job : null;
    delete out.wsId;
    if (job) await Promise.race([job, new Promise((ok) => { const t = setTimeout(ok, HOLD_MS); job.then(() =>
      clearTimeout(t), () => clearTimeout(t)); })]);
    return out;
  }
  // start(u, id, { message }) -> { message, working: true }; the reply lands in history() when it's ready.
  async function start(u, id, body = {}, ctx = {}) {
    const w = await engine.owned(u, id);
    const tag = (out) => Object.assign(out, { wsId: w.id });
    const images = await pics.claim(u, body.images);   // 0.38.0: a message's photos skip the quick paths
    const text = String(body.message == null ? '' : body.message).trim() || (images.length ? 'Build this.' : '');
    if (!text) throw err(422, 'invalid', 'Tell Colon what to build or change.');
    if (text.length > MAX_MESSAGE) throw err(422, 'invalid', `Keep a message under ${MAX_MESSAGE} characters.`);
    const recent = (await store.messages(w.id, 30)).map(msgOut);
    const busy = running.has(w.id) || pending(recent);
    if (images.length) return tag(await withPhotos(u, w, text, images, busy, ctx));
    if (busy) return tag(await side(u, w, text, recent, ctx));
    // v0.31.2: commands and questions answer in seconds; only changes build (triage.js). deps.quick switches it on.
    if (deps.quick) {
      const t = STOP.test(text) ? { kind: 'answer', stop: true } : triage.classify(text);
      if (t.kind === 'command') return tag(await command(w, text, t.action));
      if (t.stop) return tag(await command(w, text, null, 'Nothing is building right now.'));
      if (t.kind === 'answer') return tag(await quick(u, w, text, recent, ctx));
    }
    const mid = await store.addMessage(w.id, { role: 'user', content: text, kind: 'running' });
    const job = drain(u, w, { id: Number(mid), content: text }, ctx);
    if (ctx.wait) await job;   // tests
    return tag({ message: { id: Number(mid), role: 'user', content: text, kind: 'running' }, working: true });
  }

  // 0.38.0: a message with photos always builds (or waits its turn in the queue), so the model sees them
  async function withPhotos(u, w, text, images, busy, ctx) {
    const kind = busy ? 'queued' : 'running', mid = Number(await store.addMessage(w.id, { role: 'user',
      content: text, kind, images }));
    const job = busy ? null : drain(u, w, { id: mid, content: text, images }, ctx);
    if (job && ctx.wait) await job;
    return { message: { id: mid, role: 'user', content: text, kind, images }, working: true };
  }
  const stopped = async (m) => (await store.kindOf(m.id).catch(() => 'running')) === 'stopped';
  async function build(u, w0, m, ctx0) {
    const t = tracker((steps) => store.setSteps(m.id, steps), (m.steps || []).filter((x) => x.retry));
    const beat = setInterval(() => t.beat(), BEAT_MS);   // v0.31.4: proof of life for other API processes
    if (beat.unref) beat.unref();
    // each build gets its own time limit and stop switch, and the newest settings of the workspace
    const ctl = new AbortController();
    const limit = AbortSignal.timeout(BUILD_MS);
    const ctx = { ...ctx0, signal: typeof AbortSignal.any === 'function' ? AbortSignal.any([limit, ctl.signal])
      : limit };
    if (running.has(w0.id)) running.get(w0.id).ctl = ctl;
    const w = (await store.get(u.id, w0.id).catch(() => null)) || w0;
    try {
      await reply(u, w, m, ctx, t);
    } catch (e) {
      if (e.code === 'stopped') { await t.fail('Stopped'); return; }
      if (ctx.onFail) await ctx.onFail(e);
      const known = FRIENDLY[e.code] || (e.status && e.status < 500 && e.message);
      if (!known && deps.log) deps.log.error('workspace_chat_failed', { err: e.message, code: e.code });
      await store.addMessage(w.id, { role: 'assistant', error: true, steps: t.list(), content: known
        || 'Something went wrong while Colon was building. Nothing was changed; please try again.' })
        .catch(() => {});
    } finally {
      clearInterval(beat);
      await store.claimKind(m.id, 'running', 'done').catch(() => {});
    }
  }
  // Builds m, then every request queued meanwhile, oldest first, in this process.
  function drain(u, w, first, ctx) {
    const slot = { started: Date.now() };
    running.set(w.id, slot);
    return (slot.job = (async () => {
      try {
        for (let m = first; m;) {
          await build(u, w, m, ctx);
          m = (await store.messages(w.id, 30)).map(msgOut).find((x) => x.role === 'user' && x.kind === 'queued'
            && young(x, QUEUE_STALE_MS));
          if (m && !(await store.claimKind(m.id, 'queued', 'running'))) m = null;
        }
      } finally {
        running.delete(w.id);
      }
    })());
  }

  // A message sent mid-build: a quick answer from the live steps; a change request joins the queue.
  async function side(u, w, text, recent, ctx) {
    const mid = Number(await store.addMessage(w.id, { role: 'user', content: text, kind: 'side' }));
    const users = recent.filter((x) => x.role === 'user');
    const cur = users.filter((x) => x.kind === 'running').pop() || users.filter((x) => x.kind !== 'side').pop();
    if (STOP.test(text)) return stop(w, mid, text, users);
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
      if (ans.queue && !running.has(w.id)) await next(u, w, ctx);
    })().catch((e) => { if (deps.log) deps.log.error('workspace_side_failed', { err: e.message }); });
    if (ctx.wait) await job;
    return { message: { id: mid, role: 'user', content: text, kind: 'side' }, working: true };
  }

  return { send, history, _running: running };
}

module.exports = { createChat, msgOut, MAX_MESSAGE, FRIENDLY };
