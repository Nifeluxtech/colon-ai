// The tool registry and router (0.17.0, Blueprint D14: modules/tools). A fresh registry per test and the real credit
// engine (modules/billing) over its in-memory store: schema checks, plan access and monthly counts under BILLING_MODE
// off / shadow / enforce, consent, credits reserved then settled or refunded, timeouts, guests, staff, deferred calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const billing = require('../../src/modules/billing');
const toolsMod = require('../../src/modules/tools');
const registryLib = require('../../src/modules/tools/registry');

const quiet = { info() {}, warn() {}, error() {} };
const PLANS = [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 },
  { code: 'pro', name: 'Pro', price_minor: 0, currency: 'NGN', active: 1, sort: 2 }];
const ENTS = [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 10 },
  { plan_code: 'free', feature: 'image_credits', enabled: 1, limit_value: 1 },
  { plan_code: 'free', feature: 'research_tasks', enabled: 0, limit_value: 0 },
  { plan_code: 'pro', feature: 'ai_credits', enabled: 1, limit_value: 1000 },
  { plan_code: 'pro', feature: 'image_credits', enabled: 1, limit_value: 50 },
  { plan_code: 'pro', feature: 'research_tasks', enabled: 1, limit_value: 5 }];
const member = { id: 7, role: 'user' };
const proUser = { id: 8, role: 'user' };

function setup(mode = 'enforce') {
  const store = billing.memoryStore({ plans: PLANS, entitlements: ENTS, subs: { 8: { plan_code: 'pro' } } });
  const engine = billing.create({ store, cfg: { mode, credits: { chat: 1, research: 3, saga: 2 } }, cacheMs: 0 });
  const t = toolsMod.create({ registry: registryLib.create(), engine, mode, logger: quiet });
  const reg = t.registry;
  reg.register({ name: 'echo', risk: 'low', timeoutMs: 1000, guests: true, schema: { type: 'object',
    required: ['text'], properties: { text: { type: 'string', maxLength: 10 }, n: { type: 'integer', minimum: 1 } } },
  run: (a) => ({ said: a.text }) });
  reg.register({ name: 'pro_only', risk: 'low', timeoutMs: 1000, plans: ['pro'], credits: 2, run: () => 'ok' });
  reg.register({ name: 'paint', risk: 'medium', timeoutMs: 1000, entitlement: 'image_credits', credits: 3,
    run: (a, ctx) => (ctx.boom ? Promise.reject(new Error('provider down')) : 'img') });
  reg.register({ name: 'slow', risk: 'low', timeoutMs: 40, credits: 1,
    run: (a, ctx) => new Promise((resolve, reject) => { ctx.signal.addEventListener('abort', () => reject(
      Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
  reg.register({ name: 'risky', risk: 'high', timeoutMs: 1000, consent: true, credits: 4, defer: true,
    entitlement: 'research_tasks', run: () => 'queued' });
  return { t, s: store._s, engine };
}
const usage = (s, id) => s.usage.get(id);
const balance = (s, uid) => s.wallets.get(String(uid)).balance;

test('registry: bad definitions are refused; the arguments are checked against the schema', async () => {
  const reg = registryLib.create();
  assert.throws(() => reg.register({ name: 'Bad Name', risk: 'low', timeoutMs: 1 }), /bad tool name/);
  assert.throws(() => reg.register({ name: 'x1', risk: 'scary', timeoutMs: 1 }), /risk/);
  assert.throws(() => reg.register({ name: 'x2', risk: 'low' }), /timeoutMs/);
  assert.throws(() => reg.register({ name: 'x3', risk: 'high', timeoutMs: 1 }), /high risk/);
  const { t } = setup();
  await assert.rejects(t.invoke('echo', {}, {}), (e) => e.code === 'invalid' && e.field === 'text');
  await assert.rejects(t.invoke('echo', { text: 'x'.repeat(11) }, {}), (e) => e.field === 'text');
  await assert.rejects(t.invoke('echo', { text: 'hi', n: 1.5 }, {}), (e) => e.field === 'n');
  const r = await t.invoke('echo', { text: 'hi', extra: 'dropped' }, {});
  assert.deepEqual(r.result, { said: 'hi' });
  await assert.rejects(t.invoke('nope', {}, {}), (e) => e.code === 'unknown_tool' && e.status === 404);
});

test('plan access: enforce refuses, shadow runs and marks it gated, off never checks; staff are exempt', async () => {
  const enf = setup('enforce');
  await assert.rejects(enf.t.invoke('pro_only', {}, { user: member }), (e) => e.code === 'plan' && e.status === 403);
  assert.equal(enf.s.usage.size, 0, 'a refused call reserves nothing');
  const ok = await enf.t.invoke('pro_only', {}, { user: proUser });
  assert.deepEqual([ok.result, ok.reserved, ok.gated], ['ok', 2, false]);
  assert.equal(usage(enf.s, ok.requestId).status, 'settled');
  assert.equal((await enf.t.invoke('pro_only', {}, { user: { id: 99, role: 'admin' } })).reserved, 0);
  const sh = setup('shadow');
  const g = await sh.t.invoke('pro_only', {}, { user: member });
  assert.deepEqual([g.result, g.gated, g.reserved], ['ok', true, 2]);         // recorded, never blocked
  assert.equal(sh.t.stats().pro_only.gated, 1);
  const off = setup('off');
  const o = await off.t.invoke('pro_only', {}, { user: member });
  assert.deepEqual([o.gated, o.reserved, off.s.usage.size], [false, 0, 0]);
});

test('entitlement: the monthly count is the meter; disabled = plan, used up = quota (402)', async () => {
  const { t, s } = setup('enforce');
  const first = await t.invoke('paint', {}, { user: member, requestId: 'image:a' });
  assert.deepEqual([first.reserved, usage(s, 'image:a').feature, usage(s, 'image:a').status], [3, 'image_credits',
    'settled']);
  await assert.rejects(t.invoke('paint', {}, { user: member, requestId: 'image:b' }),
    (e) => e.code === 'quota' && e.status === 402 && /1 uses/.test(e.message));
  await assert.rejects(t.invoke('risky', {}, { user: member, consent: true }), (e) => e.code === 'plan');
  const sh = setup('shadow');
  await sh.t.invoke('paint', {}, { user: member, requestId: 'image:1' });
  const again = await sh.t.invoke('paint', {}, { user: member, requestId: 'image:2' });
  assert.equal(again.gated, true);                                          // over the count: allowed but recorded
});

test('credits: settled on success, refunded in full on failure and on timeout (the signal is aborted)', async () => {
  const { t, s } = setup('enforce');
  await t.invoke('paint', {}, { user: proUser, requestId: 'image:ok' });
  const before = balance(s, 8);
  await assert.rejects(t.invoke('paint', {}, { user: proUser, requestId: 'image:bad', boom: true }), /provider down/);
  assert.equal(usage(s, 'image:bad').status, 'refunded');
  assert.equal(balance(s, 8), before);
  const started = Date.now();
  await assert.rejects(t.invoke('slow', {}, { user: proUser, requestId: 'slow:1' }),
    (e) => e.code === 'tool_timeout' && e.status === 504);
  assert.ok(Date.now() - started < 1000);
  assert.equal(usage(s, 'slow:1').status, 'refunded');
  assert.equal(balance(s, 8), before);
  assert.equal(t.stats().slow.failed, 1);
  // The same request id twice is never charged twice (the engine's idempotency).
  await t.invoke('pro_only', {}, { user: proUser, requestId: 'same' });
  const b2 = balance(s, 8);
  await t.invoke('pro_only', {}, { user: proUser, requestId: 'same' });
  assert.equal(balance(s, 8), b2);
});

test('consent: refused without it (409 with its cost), runs with it; a deferred call stays reserved', async () => {
  const { t, s } = setup('enforce');
  await assert.rejects(t.invoke('risky', {}, { user: proUser }),
    (e) => e.code === 'consent_required' && e.status === 409 && e.credits === 4);
  assert.equal(s.usage.size, 0);
  const r = await t.invoke('risky', {}, { user: proUser, consent: true, requestId: 'research:1' });
  assert.deepEqual([r.result, r.deferred, usage(s, 'research:1').status], ['queued', true, 'reserved']);
  await t.close({ user: proUser, requestId: 'research:1', ok: false });
  assert.equal(usage(s, 'research:1').status, 'refunded');
  await t.invoke('risky', {}, { user: proUser, consent: true, requestId: 'research:2' });
  await t.close({ user: proUser, requestId: 'research:2', ok: true });
  assert.equal(usage(s, 'research:2').status, 'settled');
  assert.equal(await t.close({ user: proUser, requestId: 'research:2', ok: false }), null);   // once only
});

test('guests and internal calls: guests only where allowed; no user = internal (no gating, no billing)', async () => {
  const { t, s } = setup('enforce');
  assert.equal((await t.invoke('echo', { text: 'hi' }, { user: null })).result.said, 'hi');
  await assert.rejects(t.invoke('pro_only', {}, { user: null }), (e) => e.code === 'login_required');
  const internal = await t.invoke('pro_only', {}, {});
  assert.deepEqual([internal.result, internal.reserved, s.usage.size], ['ok', 0, 0]);
  // A tool whose executor lives with its caller needs ctx.run.
  t.registry.register({ name: 'caller_side', risk: 'low', timeoutMs: 1000 });
  await assert.rejects(t.invoke('caller_side', {}, {}), (e) => e.code === 'tool_no_runner');
  assert.equal((await t.invoke('caller_side', {}, { run: () => 42 })).result, 42);
  t.registry.register({ name: 'switched', risk: 'low', timeoutMs: 1000, enabled: () => false, run: () => 1 });
  await assert.rejects(t.invoke('switched', {}, {}), (e) => e.code === 'tool_off' && e.status === 503);
});

test('the shared catalogue: every tool described for Admin › Tools; the chat model gets declarations', () => {
  const list = toolsMod.list().tools;
  const names = list.map((x) => x.name);
  for (const n of ['web_search', 'web_research', 'read_url', 'extract_file', 'browse', 'read_page', 'stop_browsing',
    'generate_image', 'deep_research']) assert.ok(names.includes(n), n);
  const byName = Object.fromEntries(list.map((x) => [x.name, x]));
  assert.equal(byName.deep_research.consent, true);
  assert.equal(byName.deep_research.entitlement, 'research_tasks');
  assert.equal(byName.generate_image.entitlement, 'image_credits');
  assert.equal(byName.browse.risk, 'high');
  assert.ok(byName.browse.note.length > 10);
  for (const x of list) assert.ok(x.timeout_ms > 0 && ['low', 'medium', 'high'].includes(x.risk));
  const decls = toolsMod.declarations(['browse', 'read_page', 'stop_browsing']);
  assert.deepEqual(decls.map((d) => d.name), ['browse', 'read_page', 'stop_browsing']);
  assert.deepEqual(decls[0].parameters.required, ['task']);
  assert.equal(decls[0].parameters.properties.item.type, 'integer');
});
