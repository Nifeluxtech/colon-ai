// The job queue (0.16.0, Blueprint C11): enqueue, claim with a lease, complete, fail with exponential backoff,
// dead-letter after max attempts, cancel, retry, and runBatch (claim a few, run their handlers within a time limit).
// Storage is store.js (MySQL) or memory-store.js (tests); job types come from registry.js.
const crypto = require('crypto');

const STATUSES = ['queued', 'running', 'done', 'failed', 'dead', 'cancelled'];
const MAX_BACKOFF_MS = 6 * 3600e3;
const parse = (v) => { if (v == null) return {}; if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return {}; } };
const errText = (e) => String((e && (e.code ? `${e.code}: ${e.message}` : e.message)) || e || 'error').slice(0, 500);

/** Delay before retry n (n = attempts made so far, from 1): base, 2×base, 4×base … capped at 6 hours. */
function backoff(attempts, baseMs) {
  const n = Math.max(1, Number(attempts) || 1);
  return Math.min(MAX_BACKOFF_MS, Math.max(1000, Number(baseMs) || 60000) * 2 ** Math.min(20, n - 1));
}

function create({ store, registry, cfg, now = () => new Date(), log = require('../../shared/logger') }) {
  const c = () => (typeof cfg === 'function' ? cfg() : cfg);
  const at = () => now();

  /** enqueue(type, payload, { userId, runAt, key, ref, maxAttempts, revive }) -> { id, created } (created false: the
   *  key was already used and the first job stands; revive: a cancelled job with that key is queued again). */
  async function enqueue(type, payload = {}, o = {}) {
    const def = registry.get(type);
    if (!def) throw new Error(`jobs: unknown type ${type}`);
    const t = at();
    const runAt = o.runAt ? new Date(o.runAt) : t;
    const r = await store.insert({ type, user_id: o.userId == null ? null : Number(o.userId), payload, run_at: runAt,
      key: o.key ? String(o.key).slice(0, 120) : null, ref: o.ref ? String(o.ref).slice(0, 64) : null, now: t,
      max_attempts: Math.max(1, Number(o.maxAttempts || def.maxAttempts || c().maxAttempts) || 5) });
    // The same key again after that job was cancelled (paused, then resumed onto the same due time): revive it.
    if (!r.created && r.id && o.revive && await store.setStatus(r.id, ['cancelled'], { status: 'queued', run_at: runAt,
      attempts: 0, now: t })) return { id: r.id, created: true, revived: true };
    return r;
  }

  /** claim({ types, users, limit, leaseMs }) -> jobs leased to this caller (each with .token and parsed .payload). */
  async function claim(o) {
    const t = at();
    const token = crypto.randomBytes(16).toString('hex');
    const leaseMs = Number(o.leaseMs || c().leaseMs) || 300000;
    const rows = await store.claim({ types: o.types, users: o.users, limit: Math.max(1, Number(o.limit) || 1),
      token, leaseUntil: new Date(t.getTime() + leaseMs), now: t });
    return rows.map((r) => ({ ...r, id: Number(r.id), attempts: Number(r.attempts),
      max_attempts: Number(r.max_attempts), user_id: r.user_id == null ? null : Number(r.user_id),
      payload: parse(r.payload), token }));
  }

  const complete = (job) => store.finish(job.id, job.token, { status: 'done', now: at() });

  /** fail(job, err) -> { status: 'failed' (retry at run_at) | 'dead', run_at, stored } */
  async function fail(job, err) {
    const t = at();
    const dead = job.attempts >= job.max_attempts;
    const runAt = dead ? null : new Date(t.getTime() + backoff(job.attempts, c().backoffMs));
    const stored = await store.finish(job.id, job.token, { status: dead ? 'dead' : 'failed', run_at: runAt,
      error: errText(err), now: t });
    if (dead) log.warn('job_dead', { job: job.id, type: job.type, attempts: job.attempts, err: errText(err) });
    return { status: dead ? 'dead' : 'failed', run_at: runAt, stored };
  }

  /** Cancel one job (queued, failed or running: a running handler's result is then ignored). */
  const cancel = (id) => store.setStatus(id, ['queued', 'failed', 'running'], { status: 'cancelled', now: at() });
  /** Cancel every waiting job of `ref` except the one with idempotency key `keep`. -> how many */
  const cancelRef = (ref, keep = null) => store.cancelRef(ref, keep, at());
  /** Retry a dead, failed or cancelled job now, with its attempts reset. */
  const retry = (id) => store.setStatus(id, ['dead', 'failed', 'cancelled'], { status: 'queued', run_at: at(),
    attempts: 0, now: at() });

  function withTimeout(p, ms) {
    let timer;
    return Promise.race([p, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'timeout' })), ms);
    })]).finally(() => clearTimeout(timer));
  }

  /**
   * runBatch({ where, types?, users?, limit?, budgetMs?, ctx? }) -> { claimed, done, failed, dead, cancelled, ms }
   * Claims up to `limit` due jobs of the types this runner may run and runs them one after another. A job that
   * would outlast the budget is given what is left (at least 1 s) and fails on timeout: the batch always ends.
   */
  async function runBatch(o) {
    const start = Date.now();
    const out = { claimed: 0, done: 0, failed: 0, dead: 0, cancelled: 0, ms: 0 };
    const types = o.types || registry.typesFor(o.where || 'cron');
    if (!types.length) return out;
    const jobs = await claim({ types, users: o.users, limit: o.limit || c().batchSize });
    out.claimed = jobs.length;
    const budget = Number(o.budgetMs) || c().timeLimitMs || 50000;
    for (const job of jobs) {
      const def = registry.get(job.type);
      if (job.attempts > job.max_attempts) {          // its lease ran out too often: the runner keeps dying on it
        await store.finish(job.id, job.token, { status: 'dead', error: 'lease expired on every attempt', now: at() });
        out.dead++; continue;
      }
      const left = budget - (Date.now() - start);
      if (left < 1000) {                               // out of time: hand it back untouched for the next run
        await store.finish(job.id, job.token, { status: 'queued', run_at: at(), giveBack: true, now: at() });
        out.released = (out.released || 0) + 1; continue;
      }
      try {
        const own = typeof def.timeoutMs === 'function' ? def.timeoutMs() : def.timeoutMs;
        const ms = Math.max(1000, Math.min(left, own || c().leaseMs || 300000));
        // 0.17.0: deadline = when this batch's budget ends, so a step-wise job can leave a long step to the next run.
        await withTimeout(Promise.resolve().then(() => def.run(job, { ...(o.ctx || {}), now: at(), log,
          deadline: start + budget })), ms);
        if (await complete(job)) out.done++; else out.cancelled++;
      } catch (e) {
        const r = await fail(job, e);
        if (r.status === 'dead') out.dead++; else out.failed++;
        log.warn('job_failed', { job: job.id, type: job.type, attempt: job.attempts, err: errText(e) });
      }
    }
    out.ms = Date.now() - start;
    return out;
  }

  return { enqueue, claim, complete, fail, cancel, cancelRef, retry, runBatch, store, registry };
}

module.exports = { create, backoff, STATUSES, MAX_BACKOFF_MS, parse };
