// Jobs and cron (0.16.0, Blueprint C11-C13: modules/jobs). In-memory job store (memory-store.js, the same semantics
// as the MySQL statements in store.js) and a controllable clock; no database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../../src/modules/jobs/service');
const registryLib = require('../../src/modules/jobs/registry');
const cron = require('../../src/modules/jobs/cron');
const adminLib = require('../../src/modules/jobs/admin');
const { memoryStore } = require('../../src/modules/jobs/memory-store');
const { sqlStore } = require('../../src/modules/jobs/store');

const quiet = { info() {}, warn() {}, error() {} };
const CFG = { cronIntervalMin: 5, batchSize: 10, timeLimitMs: 20000, leaseMs: 60000, maxAttempts: 3,
  backoffMs: 60000, keepDays: 14 };

function setup(o = {}) {
  let t = new Date('2026-11-18T10:00:00Z');
  const clock = { now: () => new Date(t), add: (ms) => { t = new Date(t.getTime() + ms); } };
  const registry = o.registry || registryLib.create();
  const store = memoryStore(o.table);
  const svc = service.create({ store, registry, cfg: { ...CFG, ...(o.cfg || {}) }, now: clock.now, log: quiet });
  return { svc, store, registry, clock };
}

test('enqueue is idempotent on its key; unknown types are refused', async () => {
  const { svc, store, registry } = setup();
  registry.register('test.echo', { run() {} });
  const a = await svc.enqueue('test.echo', { n: 1 }, { key: 'echo:1', userId: 7 });
  const b = await svc.enqueue('test.echo', { n: 2 }, { key: 'echo:1', userId: 7 });
  assert.deepEqual([a.created, b.created, a.id === b.id], [true, false, true]);
  assert.equal(store.tables.jobs.length, 1);
  assert.equal(store.tables.jobs[0].payload.n, 1);                          // the first job stands
  await svc.enqueue('test.echo', {}, {});                                  // no key: always a new job
  await svc.enqueue('test.echo', {}, {});
  assert.equal(store.tables.jobs.length, 3);
  await assert.rejects(svc.enqueue('test.nope', {}), /unknown type/);
  assert.throws(() => registry.register('Bad Name', { run() {} }), /bad type name/);
  // A cancelled job comes back only when the caller asks to revive it (a schedule resumed onto the same time).
  await svc.cancel(a.id);
  assert.equal((await svc.enqueue('test.echo', {}, { key: 'echo:1' })).created, false);
  assert.equal((await svc.enqueue('test.echo', {}, { key: 'echo:1', revive: true })).revived, true);
  assert.equal(store.tables.jobs[0].status, 'queued');
});

test('lease overlap: concurrent claimers never get the same job; an expired lease is taken over once', async () => {
  const table = { jobs: [], runs: [], ids: 0 };
  const registry = registryLib.create();
  registry.register('test.work', { run() {} });
  const A = setup({ table, registry }), B = setup({ table, registry }), C = setup({ table, registry });
  for (let i = 0; i < 25; i++) await A.svc.enqueue('test.work', { i });
  const got = await Promise.all([A, B, C, A, B, C].map((x) => x.svc.claim({ types: ['test.work'], limit: 5 })));
  const ids = got.flat().map((j) => j.id);
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25, 'a job was handed to two claimers');
  assert.equal(new Set(got.flat().map((j) => j.token)).size, got.filter((g) => g.length).length);  // a token a claim
  assert.equal((await B.svc.claim({ types: ['test.work'], limit: 50 })).length, 0);   // all leased and alive
  // A's runner dies holding its jobs. After the lease, B takes the first one over; A's late result is ignored.
  const mine = got[0][0];
  [A, B, C].forEach((x) => x.clock.add(CFG.leaseMs + 1));
  const taken = await B.svc.claim({ types: ['test.work'], limit: 50 });
  assert.equal(taken.length, 25);
  const again = taken.find((j) => j.id === mine.id);
  assert.notEqual(again.token, mine.token);
  assert.equal(again.attempts, 2);
  assert.equal(await A.svc.complete(mine), false, 'the old lease must not finish the job');
  assert.equal(await B.svc.complete(again), true);
  assert.equal(table.jobs.find((j) => j.id === mine.id).status, 'done');
});

test('the MySQL claim is one guarded UPDATE, then a read-back by the lease token', async () => {
  const calls = [];
  const db = { async query(sql, p) { calls.push({ sql: sql.replace(/\s+/g, ' '), p });
    return /^UPDATE/.test(sql) ? { affectedRows: 1 } : [{ id: 1, type: 'x.y', attempts: 1, max_attempts: 3 }]; },
  async one() { return null; } };
  const store = sqlStore(db);
  await store.claim({ types: ['x.y'], users: [7], limit: 3, token: 'T'.repeat(32), leaseUntil: new Date(),
    now: new Date() });
  assert.match(calls[0].sql, /^UPDATE colon_jobs SET status = 'running', lease_token = \?/);
  assert.ok(calls[0].sql.includes("((status IN ('queued','failed') AND run_at <= ?) OR "
    + "(status = 'running' AND lease_until < ?))"));
  assert.match(calls[0].sql, /AND type IN \(\?\) AND user_id IN \(\?\) ORDER BY run_at, id LIMIT \?$/);
  assert.equal(calls[1].sql, 'SELECT * FROM colon_jobs WHERE lease_token = ? ORDER BY run_at, id');
  assert.equal(calls[1].p[0], 'T'.repeat(32));
  calls.length = 0;
  await store.finish(1, 'tok', { status: 'done', now: new Date() });
  assert.match(calls[0].sql, /WHERE id = \? AND lease_token = \?$/);
  assert.deepEqual(await store.claim({ types: ['x.y'], users: [], limit: 3 }), []);   // no phones: no query
});

test('a failing job backs off exponentially, then is dead-lettered after max attempts', async () => {
  const { svc, store, registry, clock } = setup();
  let runs = 0;
  registry.register('test.flaky', { maxAttempts: 3, run() { runs++; throw new Error('upstream 503'); } });
  const { id } = await svc.enqueue('test.flaky', {});
  const job = () => store.tables.jobs.find((j) => j.id === id);
  let r = await svc.runBatch({ where: 'cron' });
  assert.deepEqual([r.claimed, r.failed, job().status, job().attempts], [1, 1, 'failed', 1]);
  assert.equal(job().run_at - clock.now(), 60000);                          // base backoff
  assert.match(job().last_error, /upstream 503/);
  assert.equal((await svc.runBatch({ where: 'cron' })).claimed, 0);         // not due yet
  clock.add(60000);
  await svc.runBatch({ where: 'cron' });
  assert.equal(job().run_at - clock.now(), 120000);                         // doubled
  clock.add(120000);
  r = await svc.runBatch({ where: 'cron' });
  assert.deepEqual([r.dead, job().status, job().attempts, runs], [1, 'dead', 3, 3]);
  clock.add(86400e3);
  assert.equal((await svc.runBatch({ where: 'cron' })).claimed, 0);         // dead jobs stay dead
  assert.equal(service.backoff(1, 60000), 60000);
  assert.equal(service.backoff(4, 60000), 480000);
  assert.equal(service.backoff(30, 60000), service.MAX_BACKOFF_MS);
  // Retry from the dead-letter list: queued now with attempts reset; then it succeeds.
  assert.equal(await svc.retry(id), true);
  assert.deepEqual([job().status, job().attempts], ['queued', 0]);
  registry.register('test.flaky', { run() {} });
  assert.equal((await svc.runBatch({ where: 'cron' })).done, 1);
});

test('a hanging handler times out inside the run budget; out-of-time jobs are handed back untouched', async () => {
  const { svc, store, registry } = setup({ cfg: { leaseMs: 60000 } });
  registry.register('test.hang', { timeoutMs: 1000, run: () => new Promise(() => {}) });
  await svc.enqueue('test.hang', {});
  const t0 = Date.now();
  const r = await svc.runBatch({ where: 'cron', budgetMs: 5000 });
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(r.failed, 1);
  assert.match(store.tables.jobs[0].last_error, /timed out/);
  registry.register('test.quick', { run() {} });
  await svc.enqueue('test.quick', {});
  const r2 = await svc.runBatch({ types: ['test.quick'], budgetMs: 1 });
  assert.equal(r2.released, 1);
  const q = store.tables.jobs.find((j) => j.type === 'test.quick');
  assert.deepEqual([q.status, q.attempts], ['queued', 0]);
});

test('restart survival: jobs live in the store, a new process picks up queued and orphaned jobs', async () => {
  const table = { jobs: [], runs: [], ids: 0 };
  const done = [];
  const reg = () => { const r = registryLib.create(); r.register('test.keep', { run(j) { done.push(j.payload.n); } });
    return r; };
  const before = setup({ table, registry: reg() });
  await before.svc.enqueue('test.keep', { n: 1 });
  await before.svc.enqueue('test.keep', { n: 2 }, { runAt: new Date(before.clock.now().getTime() + 30e3) });
  await before.svc.claim({ types: ['test.keep'], limit: 1 });               // n=1 claimed, then the process died
  // Passenger recycled the worker: a new process with a new registry and the same table.
  const after = setup({ table, registry: reg() });
  assert.equal((await after.svc.runBatch({ where: 'cron' })).claimed, 0);   // n=1 still leased, n=2 not due
  after.clock.add(CFG.leaseMs + 1);
  const r = await after.svc.runBatch({ where: 'cron' });
  assert.equal(r.done, 2);
  assert.deepEqual(done.sort(), [1, 2]);
  assert.ok(table.jobs.every((j) => j.status === 'done'));
});

test('cron tick: recurring jobs once per period, cron jobs only, the run recorded; warning at 3x', async () => {
  const { svc, store, registry, clock } = setup();
  const seen = [];
  registry.register('test.sweep', { every: 5 * 60e3, run() { seen.push('sweep'); } });
  registry.register('test.phone', { where: 'phone', run() { seen.push('phone'); } });
  await svc.enqueue('test.phone', {}, { userId: 7 });
  const now = clock.now;
  let s = await cron.status(store, { intervalMin: 5, now });
  assert.deepEqual([s.warn, s.level], [true, 'never']);
  const run = await cron.tick(svc, { runner: 'cli', batchSize: 10, budgetMs: 10000, now });
  assert.deepEqual([run.claimed, run.done, run.error], [1, 1, null]);
  await cron.tick(svc, { runner: 'cli', batchSize: 10, budgetMs: 10000, now });    // same 5-minute slot
  assert.deepEqual(seen, ['sweep']);                                         // once; the phone job is never touched
  assert.equal(store.tables.runs.length, 2);
  s = await cron.status(store, { intervalMin: 5, now });
  assert.deepEqual([s.warn, s.level, s.last.runner], [false, 'ok', 'cli']);
  clock.add(14 * 60e3);
  assert.equal((await cron.status(store, { intervalMin: 5, now })).warn, false);
  clock.add(2 * 60e3);                                                       // 16 min > 3 x 5 min
  s = await cron.status(store, { intervalMin: 5, now });
  assert.deepEqual([s.warn, s.level], [true, 'late']);
  assert.equal((await cron.tick(svc, { batchSize: 10, budgetMs: 10000, now })).done, 1);   // the next slot
  const broken = setup();
  broken.store.ready = async () => false;
  assert.match((await cron.tick(broken.svc, { now })).error, /migration 0016/);
});

test('admin view: counts, stale leases, dead letters; retry and cancel only from the right states', async () => {
  const { svc, store, registry, clock } = setup();
  registry.register('test.a', { run() {} });
  const a = await svc.enqueue('test.a', {});
  const b = await svc.enqueue('test.a', {});
  const c = await svc.enqueue('test.a', {});
  await svc.claim({ types: ['test.a'], limit: 1 });                          // a: running
  clock.add(CFG.leaseMs + 1);                                                // a: its lease ran out (stale)
  store.tables.jobs.find((j) => j.id === c.id).status = 'dead';
  const adm = adminLib.create({ svc, cfg: CFG, now: clock.now });
  const v = await adm.overview({});
  assert.deepEqual([v.counts.running, v.counts.queued, v.counts.dead, v.stale], [1, 1, 1, 1]);
  assert.equal(v.dead[0].id, c.id);
  assert.equal(v.jobs.find((j) => j.id === a.id).stale, true);
  assert.equal(v.cron.level, 'never');
  assert.equal((await adm.overview({ status: 'stale' })).jobs.length, 1);
  await assert.rejects(adm.overview({ status: 'weird' }), (e) => e.status === 422);
  await assert.rejects(adm.retry(b.id), (e) => e.status === 409);            // queued: nothing to retry
  assert.equal((await adm.retry(c.id)).job.status, 'queued');
  assert.equal((await adm.cancel(b.id)).job.status, 'cancelled');
  await assert.rejects(adm.cancel(b.id), (e) => e.status === 409);
  await assert.rejects(adm.retry(999), (e) => e.status === 404);
  assert.throws(() => adminLib.reasonOf(' x '), (e) => e.field === 'reason');
});
