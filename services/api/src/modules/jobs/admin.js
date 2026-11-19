// Admin › Jobs (0.16.0, Blueprint C13): counts by status and type, stale leases, the dead-letter list, recent jobs,
// the cron's last run (with a warning when it is older than 3 × the interval), retry and cancel. The HTTP layer
// (modules/admin/handlers/jobs.js) checks roles and writes the audit log with the reason.
const { STATUSES } = require('./service');
const cron = require('./cron');

const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });
const iso = (v) => (v ? new Date(v).toISOString() : null);

function reasonOf(r) {
  const s = String(r == null ? '' : r).trim().replace(/\s+/g, ' ');
  if (s.length < 3) throw err(422, 'invalid', 'Give a reason (kept in the audit log).', 'reason');
  return s.slice(0, 300);
}

function view(j, now) {
  const payload = typeof j.payload === 'string' ? j.payload : JSON.stringify(j.payload || {});
  return { id: Number(j.id), type: j.type, user_id: j.user_id == null ? null : Number(j.user_id), status: j.status,
    stale: j.status === 'running' && j.lease_until != null && new Date(j.lease_until) < now,
    run_at: iso(j.run_at), attempts: Number(j.attempts) || 0, max_attempts: Number(j.max_attempts) || 0,
    last_error: j.last_error || null, ref: j.ref || null, lease_until: iso(j.lease_until),
    started_at: iso(j.started_at), finished_at: iso(j.finished_at), created_at: iso(j.created_at),
    updated_at: iso(j.updated_at), payload: payload.slice(0, 300) };
}

function create({ svc, cfg, now = () => new Date() }) {
  const c = () => (typeof cfg === 'function' ? cfg() : cfg);

  /** overview({ status, type, limit }) */
  async function overview(q = {}) {
    const t = now();
    const status = String(q.status || '');
    if (status && status !== 'stale' && !STATUSES.includes(status)) throw err(422, 'invalid', 'Unknown status.');
    const type = String(q.type || '').slice(0, 40);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const [counts, list, dead, runs, cronStatus] = await Promise.all([svc.store.counts(t),
      svc.store.list({ status, type, limit, now: t }), svc.store.list({ status: 'dead', limit: 20, now: t }),
      svc.store.recentRuns(10), cron.status(svc.store, { intervalMin: c().cronIntervalMin, now })]);
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const byType = {};
    for (const r of counts.rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + r.n;
      (byType[r.type] = byType[r.type] || { type: r.type, total: 0 })[r.status] = r.n;
      byType[r.type].total += r.n;
    }
    return { counts: byStatus, stale: counts.stale, types: Object.values(byType).sort((a, b) => b.total - a.total),
      known_types: svc.registry.all().map((d) => ({ type: d.type, where: d.where, every_ms: d.every
        ? Number(typeof d.every === 'function' ? d.every() : d.every) : null })),
      jobs: list.map((j) => view(j, t)), dead: dead.map((j) => view(j, t)),
      cron: cronStatus, runs: runs.map((r) => ({ runner: r.runner, started_at: iso(r.started_at),
        duration_ms: Number(r.duration_ms) || 0, claimed: Number(r.claimed) || 0, done: Number(r.done) || 0,
        failed: Number(r.failed) || 0, dead: Number(r.dead) || 0, error: r.error || null })),
      settings: { interval_min: c().cronIntervalMin, batch_size: c().batchSize, time_limit_ms: c().timeLimitMs,
        lease_ms: c().leaseMs, max_attempts: c().maxAttempts, inprocess: Boolean(c().inprocess),
        http_trigger: Boolean(c().cronSecret) } };
  }

  async function act(id, kind) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) throw err(404, 'not_found', 'No such job.');
    const before = await svc.store.get(n);
    if (!before) throw err(404, 'not_found', 'No such job.');
    const ok = kind === 'retry' ? await svc.retry(n) : await svc.cancel(n);
    if (!ok) {
      throw err(409, 'conflict', kind === 'retry' ? 'Only a dead, failed or cancelled job can be retried.'
        : 'Only a queued, failed or running job can be cancelled.');
    }
    return { before: view(before, now()), job: view(await svc.store.get(n), now()) };
  }

  return { overview, retry: (id) => act(id, 'retry'), cancel: (id) => act(id, 'cancel') };
}

module.exports = { create, reasonOf, view };
