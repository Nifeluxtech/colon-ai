// Deep research as a metered job (0.17.0, Blueprint D16: modules/research). The real job queue (in-memory store),
// the real tool catalogue and credit engine (in memory), a fake search and model: consent first, credits reserved at
// start and settled at the end, one step per job run, resume after a runner dies or a restart loses the next job,
// steps left to the next cron run when time is short, a refund on failure and on cancel, stale duplicates ignored.
const test = require('node:test');
const assert = require('node:assert/strict');
const billing = require('../../src/modules/billing');
const toolsMod = require('../../src/modules/tools');
const registryLib = require('../../src/modules/tools/registry');
const { registerAll } = require('../../src/modules/tools/catalogue');
const research = require('../../src/modules/research');
const service = require('../../src/modules/jobs/service');
const jobsRegistry = require('../../src/modules/jobs/registry');
const { memoryStore: jobsMemory } = require('../../src/modules/jobs/memory-store');
const config = require('../../src/config');

const quiet = { info() {}, warn() {}, error() {} };
const CFG = { maxQueries: 3, maxPages: 3, stepMs: 20000 };
const PLANS = [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 }];
const ENTS = [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 100 },
  { plan_code: 'free', feature: 'research_tasks', enabled: 1, limit_value: 2 }];
const user = { id: 9, role: 'user' };
const conv = { id: 'conv1' };

function setup(o = {}) {
  let t = new Date('2026-11-19T08:00:00Z');
  const clock = { now: () => new Date(t), add: (ms) => { t = new Date(t.getTime() + ms); } };
  const bstore = billing.memoryStore({ plans: PLANS, entitlements: ENTS });
  const engine = billing.create({ store: bstore, cfg: { mode: 'enforce', credits: { chat: 1, research: 3, saga: 2 } },
    cacheMs: 0, now: clock.now });
  const tools = toolsMod.create({ registry: registerAll(registryLib.create()), engine, mode: 'enforce',
    logger: quiet });
  const jreg = jobsRegistry.create();
  const jstore = jobsMemory();
  const jsvc = service.create({ store: jstore, registry: jreg, now: clock.now, log: quiet, cfg: { batchSize: 10,
    timeLimitMs: 60000, leaseMs: 60000, maxAttempts: 5, backoffMs: 60000 } });
  const calls = { search: [], generate: 0 };
  const deps = { cfg: CFG, now: clock.now, routing: async () => ({}), buildQueries: () => ['lagos tech hubs'],
    modelQueries: async () => ['lagos startup ecosystem 2026', 'lagos tech hubs'],
    webSearch: async (q) => { calls.search.push(q); return [{ title: `R ${q}`, url: `https://ex.com/${q.length}`,
      snippet: 's' }, { title: 'Common', url: 'https://common.ng/a', snippet: 'c' }]; },
    readMany: async (list) => new Map(list.map((r) => [r.url, { title: r.title, text: `text of ${r.url}` }])),
    contextBlock: ({ sources }) => sources.map((s) => `[${s.n}] ${s.text || ''}`).join('\n'),
    publicSources: (l) => l.map(({ text, ...x }) => x),
    generate: async () => { calls.generate++; if (o.failWrite) throw new Error('model down');
      return { text: 'Lagos report [1][2]', providerId: 'mock', model: 'm' }; },
    ...(o.deps || {}) };
  const rstore = research.memoryStore();
  const jobs = { enqueue: jsvc.enqueue, liveRefs: (r) => jstore.liveRefs(r), cancelRef: jsvc.cancelRef };
  const svc = research.create({ store: rstore, jobs, tools, deps, cfg: CFG, now: clock.now, log: quiet });
  jreg.register('research.step', { maxAttempts: 3, run: (job, ctx) => svc.runStep(job, ctx) });
  const msgs = [];
  const chat = { addUser: async (text) => { msgs.push(text); return { id: 'u1', content: text }; },
    addProgress: async (text) => ({ id: 'm1', content: text }) };
  const start = (a = {}) => svc.start({ user, conv, question: 'How big is the Lagos tech scene?', consent: true,
    chat, ...a });
  const drain = async (max = 20) => { let n = 0; for (let i = 0; i < max; i++) {
    const r = await jsvc.runBatch({ where: 'cron', budgetMs: 60000 }); n += r.claimed; if (!r.claimed) break; }
  return n; };
  return { svc, rstore, jstore, jsvc, bs: bstore._s, clock, calls, start, drain, msgs };
}

test('start needs consent (409, nothing saved or charged); then reserves the credits and queues step one', async () => {
  const x = setup();
  await assert.rejects(x.start({ consent: false }), (e) => e.code === 'consent_required' && e.status === 409
    && e.credits === config.billing.credits.deepResearch);
  assert.deepEqual([x.rstore.tables.runs.size, x.bs.usage.size, x.msgs.length], [0, 0, 0]);
  const r = await x.start();
  assert.deepEqual([r.run.status, r.run.stage, r.message.id, r.reserved], ['queued', 'plan', 'm1',
    config.billing.credits.deepResearch]);
  const u = x.bs.usage.get(`research:${r.run.id}`);
  assert.deepEqual([u.status, u.feature], ['reserved', 'research_tasks']);
  assert.equal(x.jstore.tables.jobs.length, 1);
  assert.deepEqual(x.jstore.tables.jobs[0].payload, { run_id: r.run.id, hop: 0 });
});

test('step by step to the report: one bounded step per job, progress on the message, credits settled', async () => {
  const x = setup();
  const { run } = await x.start();
  assert.equal((await x.jsvc.runBatch({ where: 'cron', budgetMs: 60000, limit: 1 })).done, 1);   // plan only
  let saved = await x.rstore.get(run.id);
  assert.deepEqual([saved.stage, saved.steps, saved.hop, saved.state.queries.length], ['search', 1, 1, 3]);
  assert.match(x.rstore.tables.messages.get('m1').content, /Searching the web \(1 of 3\)/);
  await x.drain();
  saved = await x.rstore.get(run.id);
  assert.deepEqual([saved.status, saved.steps], ['done', 6]);               // plan, 3 searches, 1 read, write
  assert.equal(x.calls.search.length, 3);
  const msg = x.rstore.tables.messages.get('m1');
  assert.equal(msg.content, 'Lagos report [1][2]');
  assert.equal(msg.sources.length, 4);
  assert.equal(msg.web.read, 3);
  assert.ok(!('text' in msg.sources[0]), 'page text never reaches the app');
  assert.equal(x.bs.usage.get(`research:${run.id}`).status, 'settled');
  assert.ok(x.jstore.tables.jobs.every((j) => j.status === 'done'));
});

test('restart: a runner that dies mid-step is taken over after its lease; a lost next job is resumed by the sweep',
  async () => {
    const x = setup();
    const { run } = await x.start();
    const claimed = await x.jsvc.claim({ types: ['research.step'], limit: 1 });   // this runner then dies
    assert.equal(claimed.length, 1);
    x.clock.add(61000);                                                        // the lease ran out
    await x.jsvc.runBatch({ where: 'cron', budgetMs: 60000, limit: 1 });       // the same step, taken over
    assert.equal((await x.rstore.get(run.id)).stage, 'search');
    // The API restarts between saving a step and queuing the next one: the next job is gone.
    x.jstore.tables.jobs = x.jstore.tables.jobs.filter((j) => j.status !== 'queued');
    assert.equal(await x.drain(), 0);
    x.clock.add(11 * 60e3);
    const s = await x.svc.sweep({ olderThanMs: 10 * 60e3 });
    assert.deepEqual([s.checked, s.resumed, s.failed], [1, 1, 0]);
    await x.drain();
    assert.equal((await x.rstore.get(run.id)).status, 'done');
    assert.equal(x.bs.usage.get(`research:${run.id}`).status, 'settled');
    // A duplicate job for an old hop does nothing.
    assert.deepEqual(await x.svc.runStep({ payload: { run_id: run.id, hop: 0 }, attempts: 1, max_attempts: 3 }),
      { skipped: 'ended' });
  });

test('too little time left: the step is handed to the next cron run untouched', async () => {
  const x = setup();
  const { run } = await x.start();
  const r = await x.svc.runStep({ payload: { run_id: run.id, hop: 0 }, attempts: 1, max_attempts: 3 },
    { deadline: Date.now() + 2000 });
  assert.deepEqual(r, { deferred: true });
  const saved = await x.rstore.get(run.id);
  assert.deepEqual([saved.stage, saved.steps, saved.hop], ['plan', 0, 1]);
  const next = x.jstore.tables.jobs.find((j) => j.payload.hop === 1);
  assert.ok(next && new Date(next.run_at) > x.clock.now(), 'queued for after this run');
  assert.deepEqual(await x.svc.runStep({ payload: { run_id: run.id, hop: 0 }, attempts: 1, max_attempts: 3 }),
    { skipped: 'stale' });
});

test('failure: retried with backoff, then the run fails and the credits are refunded', async () => {
  const x = setup({ failWrite: true });
  const { run } = await x.start();
  await x.drain();
  assert.equal((await x.rstore.get(run.id)).stage, 'write');
  for (let i = 0; i < 3; i++) { x.clock.add(10 * 60e3); await x.drain(); }
  const saved = await x.rstore.get(run.id);
  assert.equal(saved.status, 'failed');
  assert.match(saved.error, /^write: model down/);
  assert.equal(x.calls.generate, 3);
  assert.equal(x.bs.usage.get(`research:${run.id}`).status, 'refunded');
  assert.equal(x.rstore.tables.messages.get('m1').error.code, 'research_failed');
  assert.equal(x.bs.wallets.get('9').balance, 100);
});

test('cancel: only the owner, the credits come back, its jobs are cancelled; the monthly count holds', async () => {
  const x = setup();
  const { run } = await x.start();
  await assert.rejects(x.svc.cancel(10, run.id), (e) => e.status === 404);
  await assert.rejects(x.svc.status(10, run.id), (e) => e.status === 404);
  const c = await x.svc.cancel(9, run.id);
  assert.equal(c.status, 'cancelled');
  assert.equal(x.bs.usage.get(`research:${run.id}`).status, 'refunded');
  assert.ok(x.jstore.tables.jobs.every((j) => j.status === 'cancelled'));
  assert.equal(await x.drain(), 0);
  await x.start({ id: 'r2' });
  await x.start({ id: 'r3' });
  await assert.rejects(x.start({ id: 'r4' }), (e) => e.code === 'quota');   // 2 a month; the cancelled one is free
  assert.equal((await x.svc.forConversation(9, 'conv1')).length, 3);
});
