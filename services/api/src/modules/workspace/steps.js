// Workspace chat build steps (split out of chat.js in v0.31.4, size limit).
// v0.27.2: the live step list for one reply. Each change is saved on the user's message (any API process can then
// answer the poll); writes are chained so they land in order, and a failed write never stops the reply.
function tracker(save, seed = []) {
  const steps = seed.map((x) => ({ ...x })), t0 = Date.now();
  let chain = Promise.resolve();
  const flush = () => { const copy = steps.map((x) => ({ ...x })); chain = chain.then(() => save(copy)).catch(() => {});
    return chain; };
  const finish = (state, detail) => {
    const cur = steps[steps.length - 1];
    if (cur && cur.state === 'run') { cur.state = state; cur.ms = Date.now() - t0 - cur.start; }
    if (cur && detail) cur.detail = String(detail).slice(0, 120);
  };
  return {
    start(label, detail) { finish('done'); steps.push({ label, state: 'run', start: Date.now() - t0, at: Date.now(),
      ...(detail ? { detail } : {}) }); return flush(); },
    done(detail) { finish('done', detail); return flush(); },
    fail(detail) { finish('fail', detail); return flush(); },
    add(label, detail) { finish('done'); steps.push({ label, state: 'done', start: Date.now() - t0, ms: 0,
      ...(detail ? { detail } : {}) }); },
    // v0.31.4: a heartbeat: the running step's time moves on, so other processes see the build is alive
    beat() { const cur = steps[steps.length - 1]; if (!cur || cur.state !== 'run') return Promise.resolve();
      cur.at = Date.now(); return flush(); },
    list: () => steps.map((x) => ({ ...x })),
  };
}

module.exports = { tracker };
