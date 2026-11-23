// Workspace chat, fast paths (v0.31.2): tab commands answer with no model call, greetings and questions get a quick
// answer (or build when the model says BUILD:, fails or is slow), linked pages are read, and "stop" ends a build.
// Split out of chat.js (size limit); chat.js passes its store, running map and drain().
const triage = require('./triage');

const QUICK_MS = 30000;   // a quick answer gets this long, then the message builds instead
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const host = (u) => { try { return new URL(u).hostname; } catch (e) { return u; } };

// A "Reading the link(s)" build step; returns [{ url, title, text } | { url, error }].
async function linkStep(t, text, signal, readLinks, deps) {
  const urls = deps.readLink ? triage.links(text) : [];
  if (!urls.length) return [];
  await t.start(urls.length > 1 ? 'Reading the links' : 'Reading the link');
  const links = await readLinks(text, signal);
  const ok = links.filter((l) => !l.error);
  if (ok.length) await t.done(ok.map((l) => host(l.url)).join(', '));
  else await t.fail(links[0].error);
  return links;
}

function create({ engine, deps, store, running, drain }) {
  // v0.31.2: read the pages linked in a message (deps.readLink; tests pass a fake). Failures are reported, not fatal.
  async function readLinks(text, signal) {
    const urls = deps.readLink ? triage.links(text) : [];
    return Promise.all(urls.map((url) => deps.readLink(url, { query: text, signal })
      .then((p) => ({ url: p.url || url, title: p.title || '', text: String(p.text || '').slice(0, 6000) }))
      .catch((e) => ({ url, error: e.code === 'blocked_url' ? 'that address isn’t allowed'
        : e.code === 'timeout' ? 'it took too long' : e.code === 'empty' ? 'no readable text'
          : 'the page didn’t open' }))));
  }

  // v0.31.2: a tab command: saved with its one-line answer, no model call; the app switches to the tab (action).
  async function command(w, text, action, line) {
    const out = action ? triage.commandLine(action, Boolean(w.slug)) : { text: line };
    const mid = Number(await store.addMessage(w.id, { role: 'user', content: text, kind: 'quick' }));
    await store.addMessage(w.id, { role: 'assistant', content: out.text, kind: 'quick' });
    return { message: { id: mid, role: 'user', content: text, kind: 'quick' }, working: false, free: true,
      ...(out.action ? { action: out.action } : {}) };
  }

  // v0.31.2: a greeting or a question: a short answer from the file list and recent messages. When the model says
  // "BUILD:" (it was a change after all), or it fails or is slow, the message builds as before; nothing is lost.
  async function quick(u, w, text, recent, ctx) {
    const mid = Number(await store.addMessage(w.id, { role: 'user', content: text, kind: 'quick' }));
    const job = (async () => {
      let ans = { build: true };
      try {
        const bundle = await engine.bundle(u, w.id);
        const files = bundle.files.map((f) => ({ path: f.path, size: f.size, text: f.encoding === 'utf8',
          content: f.encoding === 'utf8' ? f.content : undefined }));
        const links = await readLinks(text, ctx.signal);
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), QUICK_MS);
        if (timer.unref) timer.unref();
        const signal = ctx.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([ctx.signal, ctl.signal])
          : ctl.signal;
        try {
          const r = await Promise.race([deps.generate({ mode: 'general', language: 'en', category: 'everyday',
            messages: [{ role: 'user', content: text }], taskText: text, routing: ctx.routing, signal,
            timeouts: { maxTokens: 1500 }, context: triage.context({ title: w.title, instructions: w.instructions,
              files, links, recent: recent.filter((x) => !x.error).slice(-4) }) }),
          new Promise((_, no) => { const t2 = setTimeout(() => no(err(504, 'timeout', 'slow')), QUICK_MS + 2000);
            if (t2.unref) t2.unref(); })]);
          if (ctx.record) Promise.resolve(ctx.record(r)).catch(() => {});
          ans = triage.parse(r.text);
        } finally { clearTimeout(timer); }
      } catch (e) {
        if (deps.log && deps.log.warn) deps.log.warn('workspace_quick_failed', { err: e.message });
      }
      if (!ans.build) {
        await store.addMessage(w.id, { role: 'assistant', content: ans.text, kind: 'quick' });
        return;
      }
      if (!(await store.claimKind(mid, 'quick', 'running'))) return;
      if (running.has(w.id)) { await store.setKind(mid, 'queued'); return; }
      await drain(u, w, { id: mid, content: text }, ctx);
    })().catch((e) => { if (deps.log) deps.log.error('workspace_quick_failed', { err: e.message }); });
    if (ctx.wait) await job;
    return { message: { id: mid, role: 'user', content: text, kind: 'quick' }, working: true };
  }

  // v0.27.3: "stop" ends the running build (in this process at once; in another one before it saves anything)
  // and drops the queue. Nothing is changed.
  async function stop(w, mid, text, users) {
    for (const x of users.filter((y) => y.kind === 'queued')) await store.claimKind(x.id, 'queued', 'dropped');
    const cur = users.filter((y) => y.kind === 'running').pop();
    if (cur && (await store.claimKind(cur.id, 'running', 'stopped'))) {
      await store.setSteps(cur.id, cur.steps.map((x) => (x.state === 'run' ? { ...x, state: 'fail',
        detail: 'Stopped' } : x)));
    }
    const r = running.get(w.id);
    if (r && r.ctl) r.ctl.abort();
    await store.addMessage(w.id, { role: 'assistant', kind: 'side', content: cur
      ? 'Stopped. Nothing was changed.' : 'Nothing is building right now.' });
    return { message: { id: mid, role: 'user', content: text, kind: 'side' }, working: false };
  }

  return { readLinks, command, quick, stop };
}

module.exports = { create, linkStep, QUICK_MS };
