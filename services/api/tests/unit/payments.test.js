// Unit tests for Korapay payments (modules/payments): checkout, confirm (verified with Korapay, applied once,
// amount checks), webhook signatures, period extension and the credit top-up. In-memory stores, fake Korapay.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const billing = require('../../src/modules/billing');
const payments = require('../../src/modules/payments');
const { korapay } = require('../../src/modules/payments/korapay');

const PLANS = [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 },
  { code: 'pro', name: 'Pro', price_minor: 500000, currency: 'NGN', active: 1, sort: 2 },
  { code: 'startup', name: 'Startup', price_minor: 0, currency: 'NGN', active: 1, sort: 1 }];
const ENTS = [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 100 },
  { plan_code: 'pro', feature: 'ai_credits', enabled: 1, limit_value: 2000 },
  { plan_code: 'startup', feature: 'ai_credits', enabled: 1, limit_value: 600 }];
const user = { id: 7, role: 'user', email: 'ada@example.com', name: 'Ada' };
const SECRET = 'sk_test_abc';
const CFG = { korapaySecret: SECRET, apiUrl: 'https://api.test', returnUrl: 'https://chat.test/', periodDays: 30 };

function setup({ charge = { status: 'success', amount: 5000, currency: 'NGN', fee: 75 } } = {}) {
  let t = new Date('2026-11-17T12:00:00Z');
  const now = () => t;
  const bStore = billing.memoryStore({ plans: PLANS, entitlements: ENTS });
  const pStore = payments.memoryStore({ plans: PLANS });
  bStore._s.subs = pStore._s.subs;   // one subscriptions table
  const bill = billing.create({ store: bStore, cfg: { mode: 'shadow', credits: { chat: 1, research: 3, saga: 2 } },
    now, cacheMs: 0 });
  const calls = { init: [], verify: 0 };
  const real = korapay({ secretKey: SECRET });
  const provider = {
    async initialize(p) {
      calls.init.push(p);
      return { reference: p.reference, checkout_url: 'https://checkout.korapay.com/x/pay' };
    },
    async verify(ref) { calls.verify += 1; return { reference: ref, ...charge }; },
    sign: real.sign, signatureOk: real.signatureOk,
  };
  const pay = payments.create({ store: pStore, provider, cfg: CFG,
    billing: { billable: billing.billable, planChanged: bill.planChanged }, now });
  return { pay, bill, bStore, pStore, calls, setNow: (d) => { t = d; } };
}
const sig = (data) => crypto.createHmac('sha256', SECRET).update(JSON.stringify(data)).digest('hex');

test('checkout creates a pending payment and sends naira, our reference and the webhook URL', async () => {
  const { pay, pStore, calls } = setup();
  const r = await pay.checkout(user, { plan: 'pro' });
  assert.match(r.reference, /^CLN-7-/);
  assert.equal(r.checkout_url, 'https://checkout.korapay.com/x/pay');
  const sent = calls.init[0];
  assert.equal(sent.amount, 5000);
  assert.equal(sent.currency, 'NGN');
  assert.equal(sent.notification_url, 'https://api.test/payments/korapay/webhook');
  assert.equal(sent.redirect_url, `https://chat.test/?payment=korapay&reference=${sent.reference}`);
  assert.equal(sent.customer.email, 'ada@example.com');
  assert.equal(pStore._s.payments.get(r.reference).status, 'pending');
});

test('checkout refuses free, unpriced and unknown plans, staff and guests', async () => {
  const { pay } = setup();
  for (const plan of ['free', 'startup', 'nope', undefined]) {
    await assert.rejects(pay.checkout(user, { plan }), (e) => e.status === 400);
  }
  await assert.rejects(pay.checkout({ ...user, role: 'admin' }, { plan: 'pro' }), { code: 'not_billable' });
  await assert.rejects(pay.checkout(null, { plan: 'pro' }), { code: 'not_billable' });
});

test('a verified payment starts the plan once and tops up this month', async () => {
  const { pay, bill, bStore, pStore } = setup();
  await bill.reserve({ user, requestId: 'chat:1', feature: 'chat' });   // free wallet: 100 - 1
  const { reference } = await pay.checkout(user, { plan: 'pro' });
  const r = await pay.status(user, reference);
  assert.equal(r.status, 'success');
  assert.equal(pStore._s.payments.get(reference).fee_minor, 7500);
  const sub = pStore._s.subs.get('7');
  assert.equal(sub.plan_code, 'pro');
  assert.equal(sub.period_end.toISOString(), '2026-12-17T12:00:00.000Z');
  assert.equal(bStore._s.wallets.get('7').balance, 99 + 1900);
  // The webhook arriving later changes nothing.
  const data = { reference, status: 'success', amount: 5000, currency: 'NGN' };
  const [code] = await pay.webhook({ event: 'charge.success', data }, { 'x-korapay-signature': sig(data) });
  assert.equal(code, 200);
  assert.equal(bStore._s.wallets.get('7').balance, 1999);
  assert.equal(bStore._s.ledger.filter((e) => e.ref === `plan:${reference}`).length, 1);
});

test('a short or wrong-currency payment is failed, not applied', async () => {
  for (const charge of [{ status: 'success', amount: 4999, currency: 'NGN' },
    { status: 'success', amount: 5000, currency: 'KES' }]) {
    const { pay, pStore } = setup({ charge });
    const { reference } = await pay.checkout(user, { plan: 'pro' });
    assert.equal((await pay.status(user, reference)).status, 'failed');
    assert.equal(pStore._s.subs.get('7'), undefined);
  }
});

test('processing stays pending; failed is recorded', async () => {
  let s = setup({ charge: { status: 'processing', amount: 5000, currency: 'NGN' } });
  let ref = (await s.pay.checkout(user, { plan: 'pro' })).reference;
  assert.equal((await s.pay.status(user, ref)).status, 'pending');
  s = setup({ charge: { status: 'failed', amount: 5000, currency: 'NGN' } });
  ref = (await s.pay.checkout(user, { plan: 'pro' })).reference;
  assert.equal((await s.pay.status(user, ref)).status, 'failed');
});

test('webhook with a bad signature is logged and ignored', async () => {
  const { pay, pStore, calls } = setup();
  const { reference } = await pay.checkout(user, { plan: 'pro' });
  const data = { reference, status: 'success', amount: 5000, currency: 'NGN' };
  const [code, body] = await pay.webhook({ event: 'charge.success', data }, { 'x-korapay-signature': 'f00' });
  assert.deepEqual([code, body.ok], [200, false]);
  assert.equal(calls.verify, 0);
  assert.equal(pStore._s.payments.get(reference).status, 'pending');
  assert.equal(pStore._s.events[0].outcome, 'bad_signature');
});

test('a signed webhook confirms with Korapay before applying', async () => {
  const { pay, pStore, calls } = setup();
  const { reference } = await pay.checkout(user, { plan: 'pro' });
  const data = { reference, status: 'success', amount: 5000, currency: 'NGN' };
  await pay.webhook({ event: 'charge.success', data }, { 'x-korapay-signature': sig(data) });
  assert.equal(calls.verify, 1);
  assert.equal(pStore._s.payments.get(reference).status, 'success');
  assert.equal(pStore._s.events[0].outcome, 'success');
});

test('paying again for the same plan extends from the current end date', async () => {
  const { pay, pStore, setNow } = setup();
  const a = await pay.checkout(user, { plan: 'pro' });
  await pay.status(user, a.reference);
  setNow(new Date('2026-12-01T12:00:00Z'));
  const b = await pay.checkout(user, { plan: 'pro' });
  await pay.status(user, b.reference);
  assert.equal(pStore._s.subs.get('7').period_end.toISOString(), '2027-01-16T12:00:00.000Z');
});

test('another user cannot read a payment', async () => {
  const { pay } = setup();
  const { reference } = await pay.checkout(user, { plan: 'pro' });
  await assert.rejects(pay.status({ id: 8, role: 'user' }, reference), { status: 404 });
});

test('korapay signature check is exact', () => {
  const k = korapay({ secretKey: SECRET });
  const data = { reference: 'R1', amount: 100 };
  assert.equal(k.signatureOk(data, sig(data)), true);
  assert.equal(k.signatureOk(data, sig({ ...data, amount: 101 })), false);
  assert.equal(korapay({ secretKey: '' }).signatureOk(data, sig(data)), false);
});
