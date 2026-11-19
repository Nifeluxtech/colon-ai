// The dispatcher (0.16.0, Blueprint C11): what one cron run does, whoever starts it (scripts/cron.js from cPanel cron,
// the secured HTTP trigger, or the optional in-process fallback).
//   1. enqueue this period's recurring system jobs (one per type per period: the idempotency key names the slot, so
//      overlapping or repeated runs add nothing);
//   2. claim small batches of due 'cron' jobs and run them until the time limit (JOBS_TIME_LIMIT_MS) is near;
//   3. record the run (colon_cron_runs) with its duration and counts, for Admin › Jobs.
// status() is the "cron last ran …" line, with a warning when the last run is older than 3 × JOBS_CRON_INTERVAL_MIN.
const WARN_FACTOR = 3;

const everyOf = (def) => Number(typeof def.every === 'function' ? def.every() : def.every) || 0;

/** Enqueues the recurring jobs whose slot (floor(now / every)) has no job yet. -> number added */
async function ensureRecurring(svc, now) {
  let added = 0;
  for (const def of svc.registry.recurring()) {
    const every = everyOf(def);
    if (!(every > 0)) continue;
    const slot = Math.floor(now.getTime() / every);
    const r = await svc.enqueue(def.type, {}, { key: `cron:${def.type}:${slot}`, ref: `cron:${def.type}` });
    if (r.created) added++;
  }
  return added;
}

/**
 * tick(svc, { runner, budgetMs, batchSize, now, ctx }) -> the recorded run { runner, started_at, finished_at,
 * duration_ms, claimed, done, failed, dead, error }. Never throws: an error is recorded and returned.
 */
async function tick(svc, o = {}) {
  const started = Date.now();
  const startedAt = o.now ? o.now() : new Date();
  const budget = Math.max(2000, Number(o.budgetMs) || 50000);
  const run = { runner: o.runner || 'cli', started_at: startedAt, claimed: 0, done: 0, failed: 0, dead: 0,
    error: null };
  try {
    if (!(await svc.store.ready())) throw Object.assign(new Error('colon_jobs is missing: restart the API once so '
      + 'migration 0016 runs'), { code: 'not_migrated' });
    await ensureRecurring(svc, startedAt);
    for (let i = 0; i < 20; i++) {
      const left = budget - (Date.now() - started) - 1000;     // a second kept back to record the run and exit
      if (left < 1000) break;
      const r = await svc.runBatch({ where: 'cron', limit: o.batchSize, budgetMs: left, ctx: o.ctx });
      run.claimed += r.claimed; run.done += r.done; run.failed += r.failed; run.dead += r.dead;
      if (r.claimed < (Number(o.batchSize) || 10)) break;      // the queue is empty for now
    }
  } catch (e) {
    run.error = String((e && e.message) || e).slice(0, 300);
  }
  run.finished_at = new Date(startedAt.getTime() + (Date.now() - started));
  run.duration_ms = Date.now() - started;
  if (!run.error || !/colon_jobs is missing|database not configured/.test(run.error)) {
    await svc.store.recordRun(run).catch((e) => { run.error = run.error || `record: ${e.message}`; });
  }
  return run;
}

/** status(store, { intervalMin, now }) -> { last, age_ms, interval_min, warn, level: ok | late | never } */
async function status(store, o = {}) {
  const now = (o.now ? o.now() : new Date()).getTime();
  const intervalMin = Math.max(1, Number(o.intervalMin) || 5);
  const last = await store.lastRun();
  if (!last) return { last: null, age_ms: null, interval_min: intervalMin, warn: true, level: 'never' };
  const age = Math.max(0, now - new Date(last.started_at).getTime());
  const late = age > WARN_FACTOR * intervalMin * 60e3;
  return { last: { runner: last.runner, started_at: new Date(last.started_at).toISOString(),
    duration_ms: Number(last.duration_ms) || 0, claimed: Number(last.claimed) || 0, done: Number(last.done) || 0,
    failed: Number(last.failed) || 0, dead: Number(last.dead) || 0, error: last.error || null },
  age_ms: age, interval_min: intervalMin, warn: late, level: late ? 'late' : 'ok' };
}

module.exports = { tick, status, ensureRecurring, WARN_FACTOR };
