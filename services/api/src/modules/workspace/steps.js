// Workspace chat build steps (split out of chat.js in v0.31.4, size limit).
const skills = require('../skills');

const THOUGHT_MAX = 6000;   // v0.32.0: characters of the model's reasoning kept on a step
// v0.27.2: the live step list for one reply. Each change is saved on the user's message (any API process can then
// answer the poll); writes are chained so they land in order, and a failed write never stops the reply.
function tracker(save, seed = []) {
  const steps = seed.map((x) => ({ ...x })), t0 = Date.now();
  let chain = Promise.resolve(), lastFlush = 0;
  const flush = () => { lastFlush = Date.now(); const copy = steps.map((x) => ({ ...x }));
    chain = chain.then(() => save(copy)).catch(() => {});
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
    // v0.32.0: the model's reasoning, kept on the running step and saved at most every 2 s
    think(text) {
      const cur = steps[steps.length - 1];
      if (!text || !cur || cur.state !== 'run' || (cur.thought || '').length >= THOUGHT_MAX) return;
      cur.thought = ((cur.thought || '') + text).slice(0, THOUGHT_MAX);
      if (Date.now() - lastFlush > 2000) flush();
    },
    list: () => steps.map((x) => ({ ...x })),
  };
}

// v0.32.0: picks the bundled skills for a request, shows them as a step, and returns their prompt text ('' if none)
function skillStep(t, text) {
  const picked = skills.pick(text, { mode: 'workspace' });
  if (!picked.length) return '';
  t.add(`Using the ${picked.map((s) => s.title).join(' and ')} skill${picked.length > 1 ? 's' : ''}`);
  return `\n\n${skills.block(picked)}`;
}

module.exports = { tracker, skillStep };
