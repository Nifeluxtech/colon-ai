// Unit tests for billing admin (v0.14.0, Blueprint A6–A7): manual credit grants and revokes (idempotent, never below
// 0, in one transaction), plan edits clearing the plan cache, set / comp plan, payments filter, costs aggregation and
// the daily cap, per-call cost from AI_MODEL_COSTS, and the admin-only guards. In-memory stores, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const dbPath = require.resolve('../../src/db');
const fakeDb = { async query() { return []; }, async one() { return null; } };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
const billing = require('../../src/modules/billing');
const { memoryAdminStore, aggregateCalls } = require('../../src/modules/billing/admin-store');
const costs = require('../../src/modules/ai/costs');
const calls = require('../../src/modules/ai/calls');

const PLANS = () => [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 },
  { code: 'pro', name: 'Pro', price_minor: 2100000, currency: 'NGN', active: 1, sort: 2 }];
const ENTS = () => [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 100 },
  { plan_code: 'pro', feature: 'ai_credits', enabled: 1, limit_value: 2000 }];
const NOW = new Date('2026-11-17T12:00:00Z');

function setup({ mode = 'shadow', cacheMs = 0, cap = 0, calls: rows = [], payments = [] } = {}) {
  const store = memoryAdminStore(billing.memoryStore({ plans: PLANS(), entitlements: ENTS() }), {
    users: [{ id: 7, email: 'ada@example.com', name: 'Ada', role: 'user' }, { id: 8, email: 'bo@example.com',
      role: 'user' }], calls: rows, payments });
  const cfg = { mode, credits: { chat: 1, research: 3, saga: 2 }, dailySpendCapMinor: cap, modelCosts: '' };
  const engine = billing.create({ store, cfg, now: () => NOW, cacheMs });
  const admin = billing.createAdmin({ engine, store, cfg, now: () => NOW });
  return { store, s: store._s, engine, admin };
}
const balance = (s, id = '7') => s.wallets.get(id).balance;

test('grant adds a ledger entry (kind grant, created_by the admin) and is idempotent on the key', async () => {
  const { s, admin } = setup();
  const r = await admin.adjustCredits(7, { amount: 50, reason: 'Support goodwill', key: 'k-123456' }, 1);
  assert.deepEqual([r.amount, r.balance, r.kind], [50, 150, 'grant']);
  const again = await admin.adjustCredits(7, { amount: 50, reason: 'Support goodwill', key: 'k-123456' }, 1);
  assert.equal(again.replay, true);
  assert.equal(again.balance, 150);
  assert.equal(balance(s), 150);
  const g = s.ledger.filter((e) => e.ref === 'admin:7:k-123456');
  assert.equal(g.length, 1);
  assert.equal(g[0].created_by, 1);
  assert.match(g[0].description, /Support goodwill/);
});

test('revoke never takes the balance below 0, and refuses when nothing is left', async () => {
  const { s, admin } = setup();
  const r = await admin.adjustCredits(7, { amount: -500, reason: 'Abuse', key: 'rev-0001' }, 1);
  assert.deepEqual([r.amount, r.requested, r.balance, r.kind], [-100, -500, 0, 'revoke']);
  assert.equal(balance(s), 0);
  const before = s.ledger.length;
  await assert.rejects(admin.adjustCredits(7, { amount: -1, reason: 'Again', key: 'rev-0002' }, 1),
    (e) => e.code === 'nothing_to_revoke' && e.status === 409);
  assert.equal(s.ledger.length, before);   // rolled back
  assert.equal(s.ledger.reduce((a, e) => a + (e.user_id === 7 ? e.amount : 0), 0), 0);
});

test('credits: reason, amount and user are validated', async () => {
  const { admin } = setup();
  await assert.rejects(admin.adjustCredits(7, { amount: 5, reason: ' ' }), (e) => e.field === 'reason');
  await assert.rejects(admin.adjustCredits(7, { amount: 0, reason: 'zero' }), (e) => e.field === 'amount');
  await assert.rejects(admin.adjustCredits(7, { amount: 1.5, reason: 'half' }), (e) => e.field === 'amount');
  await assert.rejects(admin.adjustCredits(99, { amount: 5, reason: 'nobody' }), (e) => e.status === 404);
  await assert.rejects(admin.adjustCredits(7, { amount: 5, reason: 'bad key', key: 'x y' }), (e) => e.field === 'key');
});

test('plan edit updates price and allowances and clears the plan cache at once', async () => {
  const { engine, admin } = setup({ cacheMs: 60000 });
  assert.equal((await engine.catalogue()).pro.entitlements.ai_credits.limit, 2000);   // cached now
  const r = await admin.updatePlan('pro', { price_minor: 2500000, name: 'Pro', entitlements: {
    ai_credits: { limit: 2500 }, research_tasks: { limit: 40 } } });
  assert.equal(r.plan.price_minor, 2500000);
  assert.deepEqual(Object.keys(r.changes).sort(), ['entitlements.ai_credits', 'entitlements.research_tasks',
    'price_minor']);
  const all = await engine.catalogue();
  assert.equal(all.pro.entitlements.ai_credits.limit, 2500);
  assert.deepEqual(all.pro.entitlements.research_tasks, { enabled: true, limit: 40 });
  await assert.rejects(admin.updatePlan('free', { price_minor: 100 }), (e) => e.field === 'price_minor');
  await assert.rejects(admin.updatePlan('free', { active: false }), (e) => e.field === 'active');
  await assert.rejects(admin.updatePlan('pro', { price_minor: 2500000 }), (e) => /Nothing to change/.test(e.message));
  await assert.rejects(admin.updatePlan('nope', { name: 'x' }), (e) => e.status === 404);
  await assert.rejects(admin.updatePlan('pro', { entitlements: { warp: 1 } }), (e) => e.field === 'entitlements');
});

test('set plan comps a plan for N days, tops credits up once, and free cancels it', async () => {
  const { s, engine, admin } = setup();
  await admin.userView(7);   // opens the wallet on Free (100)
  const r = await admin.setPlan(7, { plan: 'pro', days: 30, reason: 'Partner comp', key: 'plan-0001' }, 1);
  assert.deepEqual([r.plan, r.from, r.added, r.balance], ['pro', 'free', 1900, 2000]);
  assert.equal(new Date(r.period_end).toISOString(), '2026-12-17T12:00:00.000Z');
  assert.equal(s.subs.get('7').provider, 'admin');
  assert.equal((await engine.planFor(7)).code, 'pro');
  const again = await admin.setPlan(7, { plan: 'pro', days: 30, reason: 'Partner comp', key: 'plan-0001' }, 1);
  assert.equal(again.replay, true);
  assert.equal(balance(s), 2000);
  await assert.rejects(admin.setPlan(7, { plan: 'pro', days: 0, reason: 'x y z' }), (e) => e.field === 'days');
  await assert.rejects(admin.setPlan(7, { plan: 'gold', days: 5, reason: 'x y z' }), (e) => e.field === 'plan');
  await admin.setPlan(7, { plan: 'free', reason: 'Comp ended', key: 'plan-0002' }, 1);
  assert.equal((await engine.planFor(7)).code, 'free');
  const v = await admin.userView('ada@example.com');
  assert.equal(v.plan.code, 'free');
  assert.equal(v.subscription.status, 'cancelled');
  assert.ok(v.ledger.length >= 2);
});

test('payments list filters by status; unknown status refused', async () => {
  const { admin } = setup({ payments: [{ reference: 'A', user_id: 7, plan_code: 'pro', amount_minor: 2100000,
    currency: 'NGN', status: 'success' }, { reference: 'B', user_id: 8, plan_code: 'pro', amount_minor: 2100000,
    currency: 'NGN', status: 'pending' }] });
  assert.deepEqual((await admin.payments()).payments.map((p) => p.reference), ['B', 'A']);
  assert.deepEqual((await admin.payments({ status: 'success' })).payments.map((p) => p.reference), ['A']);
  await assert.rejects(admin.payments({ status: 'weird' }), (e) => e.field === 'status');
});

test('costs: per day (gaps filled), per model, per plan, top users, today vs the cap', async () => {
  const at = (d) => new Date(`${d}Z`);
  const rows = [
    { created_at: at('2026-11-17T08:00:00'), provider: 'google', model: 'g1', plan_code: 'pro', user_id: 7,
      input_tokens: 1000, output_tokens: 500, cost_minor: 60 },
    { created_at: at('2026-11-17T09:00:00'), provider: 'groq', model: 'q', plan_code: 'free', user_id: 8,
      input_tokens: 200, output_tokens: 100, cost_minor: 25 },
    { created_at: at('2026-11-15T09:00:00'), provider: 'google', model: 'g1', plan_code: 'pro', user_id: 7,
      input_tokens: 10, output_tokens: 10, cost_minor: 5 },
    { created_at: at('2026-11-17T10:00:00'), provider: 'groq', model: 'q', guest: 1, input_tokens: 5,
      output_tokens: 5, cost_minor: 0 },
    { created_at: at('2026-11-01T09:00:00'), provider: 'google', model: 'g1', plan_code: 'pro', user_id: 7,
      input_tokens: 9999, output_tokens: 9999, cost_minor: 999 },   // outside the window
  ];
  const { admin } = setup({ calls: rows, cap: 100 });
  const c = await admin.costs({ days: 3 });
  assert.deepEqual(c.byDay.map((d) => [d.day, d.cost_minor]), [['2026-11-15', 5], ['2026-11-16', 0],
    ['2026-11-17', 85]]);
  assert.equal(c.totals.cost_minor, 90);
  assert.equal(c.totals.calls, 4);
  assert.deepEqual(c.byModel.map((m) => [m.model, m.calls, m.cost_minor]), [['g1', 2, 65], ['q', 2, 25]]);
  assert.deepEqual(c.byPlan.map((p) => p.plan), ['pro', 'free', 'guest']);
  assert.deepEqual(c.topUsers.map((u) => [u.user_id, u.email, u.cost_minor]), [[7, 'ada@example.com', 65],
    [8, 'bo@example.com', 25]]);
  assert.deepEqual(c.today.cap, { cap_minor: 100, spend_minor: 85, pct: 85, level: 'warn' });
  assert.equal((await admin.costs({ days: 99 })).days, 30);
  assert.equal(aggregateCalls([], { since: '2026-11-17 00:00:00', today: '2026-11-17 00:00:00' }).today.calls, 0);
});

test('cap status: off, ok, warn at 80 %, over at 100 %', () => {
  assert.equal(billing.capStatus(500, 0).level, 'off');
  assert.equal(billing.capStatus(79, 100).level, 'ok');
  assert.equal(billing.capStatus(80, 100).level, 'warn');
  assert.equal(billing.capStatus(100, 100).level, 'over');
  assert.equal(billing.capStatus(250, 100).pct, 250);
});

test('model prices: kobo per 1M tokens, provider:model > model > provider:*, unpriced = 0', () => {
  const t = costs.parse('{"google:g1":[1000000,2000000],"g1":[1,1],"groq:*":{"in":500000,"out":500000},"bad":["x"]}');
  assert.equal(costs.costOf({ provider: 'google', model: 'g1', input: 1000, output: 500 }, t), 2000);
  assert.equal(costs.costOf({ provider: 'other', model: 'g1', input: 1e6, output: 0 }, t), 1);
  assert.equal(costs.costOf({ provider: 'groq', model: 'any', input: 300, output: 0 }, t), 150);
  assert.equal(costs.costOf({ provider: 'openrouter', model: 'free', input: 1e6, output: 1e6 }, t), 0);
  assert.equal(t.bad, undefined);
  assert.deepEqual(costs.parse('not json'), {});
  assert.deepEqual(costs.tokens({ prompt_tokens: 12, completion_tokens: 3 }), { input: 12, output: 3 });
  assert.equal(costs.tokens({}), null);
});

test('ai_calls rows carry user, plan, tokens and cost; failed attempts cost 0', () => {
  const t = costs.parse('{"m1":[1000000,1000000]}');
  const rows = calls.rowsFor({ mode: 'general', route: 'general', userId: 7, plan: 'pro', attempts: [
    { provider: 'p', model: 'm1', ok: false, code: 'timeout', ms: 10 },
    { provider: 'p', model: 'm1', ok: true, ms: 900, usage: { input: 30, output: 12 } }] }, t);
  assert.deepEqual(rows[0].slice(10), [7, 'pro', 0, 0, 0]);
  assert.deepEqual(rows[1].slice(10), [7, 'pro', 30, 12, 42]);
  assert.deepEqual(calls.rowsFor({ guest: true, attempts: [] }, t)[0].slice(10), [null, '', 0, 0, 0]);
});

test('billing admin routes: admin and super admin only (2FA), and nobody changes their own credits', async () => {
  const r = require('../../src/http/routes/admin/billing');
  assert.equal(r.routes.length, 7);
  const RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };
  for (const route of r.routes) {
    for (const role of Object.keys(RANK)) {
      const ok = await route.handlers[0]({ user: { id: 1, role, totp_enabled: 1 } }).then(() => true, () => false);
      assert.equal(ok, RANK[role] >= 2, `${route.method} ${route.re} as ${role}`);
    }
    await assert.rejects(route.handlers[0]({ user: { id: 1, role: 'admin', totp_enabled: 0 } }),
      (e) => e.code === 'needs_2fa');
  }
  const credits = r.routes.find((x) => x.method === 'POST' && /credits/.test(x.re.source));
  await assert.rejects(credits.handlers[1]({ user: { id: 5, role: 'admin' }, params: { id: '5' },
    body: { amount: 10, reason: 'self grant' } }), (e) => e.code === 'self');
  const plan = r.routes.find((x) => x.method === 'POST' && /plan\$/.test(x.re.source));
  await assert.rejects(plan.handlers[1]({ user: { id: 5, role: 'admin' }, params: { id: '5' },
    body: { plan: 'pro', days: 3, reason: 'self comp' } }), (e) => e.code === 'self');
});

test('the winning attempt carries the tokens the provider reported (for ai_calls and settle)', async () => {
  const { generate } = require('../../src/modules/ai/generate');
  const routing = { providers: () => ({ mock: { name: 'Mock', baseUrl: 'https://mock.provider/v1', apiKey: 'k' } }),
    targets: () => ({ m: [{ provider: 'mock', model: 'mock-1' }] }),
    routes: { general: ['m'], study: ['m'], research: ['m'], developer: ['m'], african: ['m'] },
    africanLanguages: [], models: [] };
  const chunks = [{ choices: [{ delta: { content: 'Hi' } }] },
    { choices: [], usage: { prompt_tokens: 21, completion_tokens: 4 } }];
  const enc = new TextEncoder();
  const fetch = async () => new Response(new ReadableStream({ start(c) {
    chunks.forEach((j) => c.enqueue(enc.encode(`data: ${JSON.stringify(j)}\n\n`)));
    c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200,
    headers: { 'content-type': 'text/event-stream' } });
  const r = await generate({ mode: 'general', language: 'en', routing, fetch, category: 'everyday',
    messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(r.text, 'Hi');
  assert.deepEqual(r.usage, { input: 21, output: 4 });
  assert.deepEqual(r.attempts[0].usage, { input: 21, output: 4 });
});
