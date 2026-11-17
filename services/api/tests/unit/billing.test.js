// Unit tests for the credit engine (modules/billing): monthly grants, reserve/settle/refund, idempotency,
// enforce vs shadow, staff and guests, quotas. In-memory store, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const billing = require('../../src/modules/billing');

const PLANS = [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 },
  { code: 'pro', name: 'Pro', price_minor: 0, currency: 'NGN', active: 1, sort: 2 },
  { code: 'old', name: 'Old', price_minor: 0, currency: 'NGN', active: 0, sort: 9 }];
const ENTS = [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 5 },
  { plan_code: 'free', feature: 'research_tasks', enabled: 1, limit_value: 2 },
  { plan_code: 'pro', feature: 'ai_credits', enabled: 1, limit_value: 2000 },
  { plan_code: 'old', feature: 'ai_credits', enabled: 1, limit_value: 99999 }];
const CREDITS = { chat: 1, research: 3, saga: 2 };
const user = { id: 7, role: 'user' };

function engine(mode = 'enforce', opts = {}) {
  const store = billing.memoryStore({ plans: PLANS, entitlements: ENTS, subs: opts.subs || {} });
  let t = opts.now || new Date('2026-11-17T12:00:00Z');
  const e = billing.create({ store, cfg: { mode, credits: CREDITS }, now: () => t, cacheMs: 0 });
  return { e, store, s: store._s, setNow: (d) => { t = d; } };
}
const sum = (s, uid) => s.ledger.filter((x) => x.user_id === uid).reduce((a, x) => a + x.amount, 0);

test('first use grants the plan credits and reserves the cost', async () => {
  const { e, s } = engine();
  const r = await e.reserve({ user, requestId: 'chat:1', feature: 'chat', mode: 'general' });
  assert.deepEqual([r.reserved, r.balance], [1, 4]);
  assert.equal(s.wallets.get('7').balance, 4);
  assert.deepEqual(s.ledger.map((x) => x.kind), ['grant', 'usage']);
  assert.equal(sum(s, 7), 4);
});

test('research mode costs more', async () => {
  const { e } = engine();
  assert.equal((await e.reserve({ user, requestId: 'chat:r', feature: 'chat', mode: 'research' })).reserved, 3);
});

test('same request id is never charged twice', async () => {
  const { e, s } = engine();
  await e.reserve({ user, requestId: 'chat:1', feature: 'chat' });
  const again = await e.reserve({ user, requestId: 'chat:1', feature: 'chat' });
  assert.equal(again.replay, true);
  assert.equal(s.wallets.get('7').balance, 4);
  assert.equal(s.ledger.filter((x) => x.kind === 'usage').length, 1);
});

test('enforce: refuses when credits run out, without touching the ledger', async () => {
  const { e, s } = engine();
  for (let i = 0; i < 5; i++) await e.reserve({ user, requestId: `chat:${i}`, feature: 'chat' });
  const before = s.ledger.length;
  await assert.rejects(e.reserve({ user, requestId: 'chat:x', feature: 'chat' }),
    (err) => err.code === 'quota' && err.status === 402 && /5 Colon credits on the Free plan/.test(err.message)
      && /1 December/.test(err.message));
  assert.equal(s.ledger.length, before);
  assert.equal(s.usage.has('chat:x'), false);
});

test('shadow: records but never blocks (balance may go negative)', async () => {
  const { e, s } = engine('shadow');
  for (let i = 0; i < 7; i++) await e.reserve({ user, requestId: `chat:${i}`, feature: 'chat' });
  assert.equal(s.wallets.get('7').balance, -2);
  assert.equal(sum(s, 7), -2);
  assert.equal([...s.usage.values()][0].enforced, false);
});

test('off, staff and guests: nothing recorded', async () => {
  assert.equal(await engine('off').e.reserve({ user, requestId: 'a', feature: 'chat' }), null);
  const { e, s } = engine();
  assert.equal(await e.reserve({ user: { id: 1, role: 'admin' }, requestId: 'b', feature: 'chat' }), null);
  assert.equal(await e.reserve({ user: null, requestId: 'c', feature: 'chat' }), null);
  assert.equal(s.ledger.length, 0);
});

test('refund gives the reservation back once; settle after refund does nothing', async () => {
  const { e, s } = engine();
  await e.reserve({ user, requestId: 'chat:1', feature: 'chat', mode: 'research' });
  assert.equal(s.wallets.get('7').balance, 2);
  assert.deepEqual(await e.refund({ user, requestId: 'chat:1' }), { refunded: 3 });
  assert.equal(await e.refund({ user, requestId: 'chat:1' }), null);
  assert.equal(await e.settle({ user, requestId: 'chat:1' }), null);
  assert.equal(s.wallets.get('7').balance, 5);
  assert.equal(s.usage.get('chat:1').status, 'refunded');
  assert.equal(sum(s, 7), 5);
});

test('settle to a smaller or larger actual charge adjusts the balance', async () => {
  const { e, s } = engine();
  await e.reserve({ user, requestId: 'r1', feature: 'chat', mode: 'research' });   // 5 -> 2
  await e.settle({ user, requestId: 'r1', credits: 1, provider: 'google', model: 'gemini' });   // -> 4
  assert.equal(s.wallets.get('7').balance, 4);
  assert.equal(s.usage.get('r1').credits_charged, 1);
  assert.equal(s.usage.get('r1').model, 'gemini');
  await e.reserve({ user, requestId: 'r2', feature: 'chat' });   // -> 3
  await e.settle({ user, requestId: 'r2', credits: 2 });   // -> 2
  assert.equal(s.wallets.get('7').balance, 2);
  assert.equal(await e.settle({ user, requestId: 'r2', credits: 0 }), null);   // already settled
  assert.equal(sum(s, 7), 2);
});

test('new month: leftover expires and the plan credits are granted again', async () => {
  const { e, s, setNow } = engine();
  await e.reserve({ user, requestId: 'a', feature: 'chat' });   // Nov: 4 left
  setNow(new Date('2026-12-02T08:00:00Z'));
  const r = await e.reserve({ user, requestId: 'b', feature: 'chat' });
  assert.equal(r.balance, 4);
  assert.deepEqual(s.ledger.map((x) => x.kind), ['grant', 'usage', 'expire', 'grant', 'usage']);
  assert.equal(s.wallets.get('7').period, '2026-12');
  assert.equal(sum(s, 7), 4);
});

test('active subscription uses its plan; an inactive plan falls back to Free', async () => {
  const pro = engine('enforce', { subs: { 7: { plan_code: 'pro', status: 'active' } } });
  assert.equal((await pro.e.reserve({ user, requestId: 'a', feature: 'chat' })).balance, 1999);
  const old = engine('enforce', { subs: { 7: { plan_code: 'old', status: 'active' } } });
  assert.equal((await old.e.reserve({ user, requestId: 'a', feature: 'chat' })).balance, 4);
});

test('a failed step rolls the whole transaction back', async () => {
  const { e, store, s } = engine();
  const orig = store.addUsage;
  store.addUsage = async () => { throw new Error('disk full'); };
  await assert.rejects(e.reserve({ user, requestId: 'a', feature: 'chat' }), /disk full/);
  assert.equal(s.ledger.length, 0);
  assert.equal(s.wallets.size, 0);
  store.addUsage = orig;
});

test('monthly quota for counted features', async () => {
  const { e } = engine();
  await e.reserve({ user, requestId: 'r1', feature: 'research_tasks', credits: 0 });
  assert.deepEqual(await e.checkQuota(user, 'research_tasks'), { allowed: true, limit: 2, used: 1, remaining: 1 });
  await e.reserve({ user, requestId: 'r2', feature: 'research_tasks', credits: 0 });
  assert.equal((await e.checkQuota(user, 'research_tasks')).allowed, false);
  assert.equal((await e.checkQuota(user, 'image_credits')).allowed, false);   // not in the plan
  assert.equal((await e.checkQuota({ id: 1, role: 'admin' }, 'image_credits')).allowed, true);
});

test('summary: plan, credits and ledger for the account page', async () => {
  const { e } = engine();
  await e.reserve({ user, requestId: 'a', feature: 'chat' });
  const out = await e.summary(user);
  assert.equal(out.plan.code, 'free');
  assert.deepEqual(out.credits, { balance: 4, monthly: 5, period: '2026-11', renews: '1 December' });
  assert.equal(out.ledger[0].kind, 'usage');
  assert.deepEqual(out.plans.map((p) => p.code), ['free', 'pro']);
  assert.equal((await e.summary(null)).billable, false);
});

test('helpers', () => {
  assert.equal(billing.nextPeriodName('2026-12'), '1 January');
  assert.deepEqual(billing.monthRange('2026-12'), ['2026-12-01 00:00:00', '2027-01-01 00:00:00']);
  assert.equal(billing.cost('chat', 'research', { credits: CREDITS }), 3);
  assert.equal(billing.billable({ id: 2, role: 'moderator' }), false);
});
