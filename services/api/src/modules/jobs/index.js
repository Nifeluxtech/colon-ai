// Jobs module (0.16.0, Production Blueprint step C): a durable job table (colon_jobs) with leases, retries with
// backoff and a dead-letter state, run by the cPanel cron dispatcher (services/api/scripts/cron.js), by the API
// worker that holds a user's phone (Saga's scheduled checks), and optionally by an in-process fallback
// (JOBS_INPROCESS=on). Work survives Passenger recycling the API: it lives in MySQL, not in a timer.
// Other modules use only this file: enqueue / cancelRef / runBatch, the admin view, the cron tick and its HTTP trigger.
const crypto = require('crypto');
const config = require('../../config');
const log = require('../../shared/logger');
const registryLib = require('./registry');
const service = require('./service');
const cron = require('./cron');
const { sqlStore } = require('./store');
const { memoryStore } = require('./memory-store');
const { registerAll } = require('./types');

const cfg = () => config.jobs;
let store = null;
let svc = null;
let clock = () => new Date();
const registry = registerAll(registryLib.create(), cfg, () => instance().store);

function instance() {
  if (!svc) svc = service.create({ store: store || (store = sqlStore()), registry, cfg, now: () => clock() });
  return svc;
}

/** Tests: use another store (memoryStore()) and clock. */
function use(o = {}) {
  if (o.store) store = o.store;
  if (o.now) clock = o.now;
  svc = null;
  return instance();
}

const tick = (o = {}) => cron.tick(instance(), { batchSize: cfg().batchSize, budgetMs: cfg().timeLimitMs,
  now: () => clock(), ...o });
const status = () => cron.status(instance().store, { intervalMin: cfg().cronIntervalMin, now: () => clock() });
let sharedAdmin = null;
const admin = () => (sharedAdmin && sharedAdmin.svc === instance() ? sharedAdmin.api
  : (sharedAdmin = { svc: instance(), api: require('./admin').create({ svc: instance(), cfg, now: () => clock() }) })
    .api);

// The secondary trigger (POST /internal/cron/run, header X-Cron-Secret). Off while CRON_SECRET is empty (404).
function secretOk(given) {
  const want = String(cfg().cronSecret || '');
  if (!want) return null;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}
async function postCronRun(req) {
  const ok = secretOk(req.headers && req.headers['x-cron-secret']);
  if (ok === null) throw Object.assign(new Error('Not found.'), { status: 404, code: 'not_found' });
  if (!ok) throw Object.assign(new Error('Bad cron secret.'), { status: 403, code: 'forbidden' });
  const run = await tick({ runner: 'http', budgetMs: Math.min(25000, cfg().timeLimitMs || 25000) });
  return [run.error ? 500 : 200, { ok: !run.error, run }];
}

// The in-process fallback (JOBS_INPROCESS=on): this API worker also runs the cron's work every interval, for hosts
// where cron is not set up yet. Off by default: Passenger may idle the worker, which is why cron is the dispatcher.
let timer = null, busy = false;
function startInProcess() {
  if (timer || !cfg().inprocess) return false;
  const every = Math.max(1, Number(cfg().cronIntervalMin) || 5) * 60e3;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    tick({ runner: 'inprocess', budgetMs: Math.min(20000, cfg().timeLimitMs || 20000) })
      .then((r) => { if (r.error) log.warn('jobs_inprocess_failed', { err: r.error }); })
      .finally(() => { busy = false; });
  }, every);
  if (timer.unref) timer.unref();
  return true;
}
function stopInProcess() { if (timer) clearInterval(timer); timer = null; }

module.exports = {
  registry, use, instance, memoryStore, backoff: service.backoff, STATUSES: service.STATUSES,
  enqueue: (type, payload, o) => instance().enqueue(type, payload, o),
  cancelRef: (ref, keep) => instance().cancelRef(ref, keep),
  runBatch: (o) => instance().runBatch(o),
  liveRefs: (refs) => instance().store.liveRefs(refs),
  tick, status, admin, adminReason: (r) => require('./admin').reasonOf(r),
  handlers: { postCronRun },
  startInProcess, stopInProcess, WARN_FACTOR: cron.WARN_FACTOR,
};
