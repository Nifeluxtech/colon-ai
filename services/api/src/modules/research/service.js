// Deep research as a metered, resumable background job (0.17.0, Blueprint D16).
//   start()    the user confirmed (the deep_research tool needs consent): credits are reserved through the tool
//              registry, the question and a progress message are added to the chat, the run is saved and its first
//              'research.step' job is queued. Nothing runs inside the request.
//   runStep()  the 'research.step' job (the cron dispatcher, DB-direct): one bounded step (steps.js), saved, then the
//              next step's job queued. When the runner has too little of its time limit left for the step, the step
//              is handed to the next cron run untouched. A failed step is retried with backoff; after the last attempt
//              the run fails and its credits are refunded.
//   sweep()    the 'research.sweep' job (every cron interval): a live run with no live job (a runner died between
//              saving and queuing, a job was cancelled from Admin › Jobs) is resumed, or ended and refunded.
//   cancel()   the user stops a run: it ends, its jobs are cancelled and the credits refunded.
const crypto = require('crypto');
const steps = require('./steps');

const TERMINAL = ['done', 'failed', 'cancelled'];
const ref = (id) => `research:${id}`;
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

function progressText(run, cfg) {
  const st = run.state || {};
  const label = steps.LABEL[run.stage] || 'Working';
  const extra = run.stage === 'search' && st.queries ? ` (${Math.min((st.qi || 0) + 1, st.queries.length)} of `
    + `${st.queries.length})` : run.stage === 'read' && st.results ? ` (${st.read || 0} of ${Math.min(cfg.maxPages,
    st.results.length)} read)` : '';
  return `_Deep research · ${label}${extra}… It runs in the background; the report will appear here._`;
}

function create(o) {
  const { store, jobs, tools, deps, log } = o;
  const cfg = () => (typeof o.cfg === 'function' ? o.cfg() : o.cfg);
  const now = o.now || (() => new Date());
  const ownerOf = (run) => ({ id: Number(run.user_id), role: 'user' });

  const runOut = (r) => ({ id: r.id, status: r.status, stage: r.stage, steps: r.steps, total: steps.total(r.state || {},
    cfg()), label: TERMINAL.includes(r.status) ? null : steps.LABEL[r.stage], conversation_id: r.conversation_id,
  message_id: r.message_id, question: r.question, error: r.error || null, created_at: r.created_at,
  finished_at: r.finished_at || null });

  const enqueue = (run, hop, runAt) => jobs.enqueue('research.step', { run_id: run.id, hop }, { userId: run.user_id,
    key: `${ref(run.id)}:${hop}`, ref: ref(run.id), runAt, revive: true });

  /** start({ user, conv, question, language, consent, chat }) -> { run, user_message, message, reserved } */
  async function start(a) {
    const id = a.id || crypto.randomBytes(12).toString('base64url');
    const requestId = ref(id);
    const r = await tools.invoke('deep_research', { question: a.question }, { user: a.user, consent: a.consent,
      requestId, run: async (args) => {
        const userMsg = await a.chat.addUser(args.question);
        const msg = await a.chat.addProgress(progressText({ stage: 'plan', state: {} }, cfg()));
        const row = { id, user_id: a.user.id, conversation_id: a.conv.id, message_id: msg.id, question: args.question,
          language: a.language || 'en', status: 'queued', stage: 'plan', state: {}, request_id: requestId, now: now() };
        await store.insert(row);
        await enqueue(row, 0);
        return { run: await store.get(id), user_message: userMsg, message: msg };
      } });
    return { ...r.result, run: runOut(r.result.run), reserved: r.reserved };
  }

  /** Ends a live run once: writes the message, settles (done) or refunds (failed / cancelled) its credits. */
  async function finalize(run, status, data = {}) {
    const ended = await store.finish(run.id, { status, stage: status === 'done' ? 'done' : run.stage, now: now(),
      error: data.error, steps: run.steps });
    if (!ended) return false;
    if (status === 'done') {
      await store.setMessage(run.message_id, { content: data.content, status: 'complete', sources: data.sources,
        web: data.web });
    } else {
      const message = status === 'cancelled' ? 'Deep research was stopped. Your credits were given back.'
        : 'Deep research couldn’t finish. Your credits were given back. Try again later.';
      await store.setMessage(run.message_id, { content: status === 'cancelled' ? message : '', status: status
        === 'cancelled' ? 'complete' : 'error', error: status === 'cancelled' ? null : { code: 'research_failed',
        message } });
    }
    await tools.close({ user: ownerOf(run), requestId: run.request_id, ok: status === 'done',
      reason: status === 'cancelled' ? 'Deep research stopped' : 'Deep research failed' })
      .catch((e) => log.warn('research_close_failed', { run: run.id, err: e.message }));
    log.info('research_finished', { run: run.id, status, steps: run.steps });
    return true;
  }

  async function runStep(job, ctx = {}) {
    const run = await store.get(job.payload && job.payload.run_id);
    if (!run || TERMINAL.includes(run.status)) return { skipped: 'ended' };
    if (Number(job.payload.hop) !== run.hop) return { skipped: 'stale' };
    const needMs = steps.need(run.stage, cfg());
    const left = ctx.deadline ? ctx.deadline - Date.now() : Infinity;
    if (left < needMs) {                         // not enough of this cron run left: the next run takes it
      if (await store.advance(run.id, run.hop, { status: run.status, stage: run.stage, state: run.state,
        now: now() })) await enqueue(run, run.hop + 1, new Date(now().getTime() + Math.max(0, left) + 1000));
      return { deferred: true };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), needMs);
    let r;
    try {
      r = await steps.step(run, deps, ctl.signal);
    } catch (e) {
      const last = Number(job.attempts) >= Number(job.max_attempts) || e.permanent;
      log.warn('research_step_failed', { run: run.id, stage: run.stage, attempt: job.attempts, last: Boolean(last),
        err: String(e.message || e).slice(0, 160) });
      if (last) { await finalize(run, 'failed', { error: `${run.stage}: ${String(e.message || e).slice(0, 200)}` });
        return { failed: true }; }
      throw e;                                   // retried with backoff; the run's state is unchanged
    } finally { clearTimeout(timer); }
    if (r.done) { await finalize({ ...run, steps: run.steps + 1 }, 'done', r.done); return { done: true }; }
    const next = { ...run, stage: r.stage, state: r.state, status: 'running' };
    if (!(await store.advance(run.id, run.hop, { status: 'running', stage: r.stage, state: r.state, steps: 1,
      now: now() }))) return { skipped: 'raced' };
    await store.setMessage(run.message_id, { content: progressText(next, cfg()), status: 'complete' })
      .catch(() => {});
    await enqueue(run, run.hop + 1);
    return { stage: r.stage };
  }

  /** sweep({ olderThanMs }) -> { checked, resumed, failed } */
  async function sweep(a = {}) {
    const out = { checked: 0, resumed: 0, failed: 0 };
    const before = new Date(now().getTime() - (Number(a.olderThanMs) || 10 * 60e3));
    const list = await store.stuck(before, 50);
    if (!list.length) return out;
    const live = new Set(await jobs.liveRefs(list.map((r) => ref(r.id))));
    for (const run of list) {
      if (live.has(ref(run.id))) continue;
      out.checked++;
      const q = await enqueue(run, run.hop);
      if (q.created) out.resumed++;
      else if (await finalize(run, 'failed', { error: 'its job ended without finishing' })) out.failed++;
    }
    if (out.checked) log.info('research_swept', out);
    return out;
  }

  async function cancel(userId, id) {
    const run = await store.owned(userId, id);
    if (!run) throw err(404, 'not_found', 'This research task no longer exists.');
    if (TERMINAL.includes(run.status)) return runOut(run);
    await finalize(run, 'cancelled');
    await jobs.cancelRef(ref(run.id)).catch(() => 0);
    return runOut(await store.get(run.id));
  }

  async function status(userId, id) {
    const run = await store.owned(userId, id);
    if (!run) throw err(404, 'not_found', 'This research task no longer exists.');
    return runOut(run);
  }
  const forConversation = async (userId, convId) => (await store.forConversation(userId, convId, 20)).map(runOut);

  return { start, runStep, sweep, cancel, status, forConversation, finalize, runOut, progressText };
}

module.exports = { create, TERMINAL, ref };
