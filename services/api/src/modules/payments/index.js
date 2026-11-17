// Payments (v0.13.0, Blueprint step A5): plan upgrades paid through Korapay Checkout Redirect.
//
//   checkout   POST /account/billing/checkout {plan}: a pending payments row with our own reference, then
//              Korapay's initialize charge; the app opens the returned checkout_url.
//   confirm    the only way a plan is granted. Always asks Korapay (GET /charges/:reference) and never trusts a
//              webhook body or the return URL. Inside one transaction with the payment row locked: amount and
//              currency must match, then the payment is marked success and the subscription starts (or is
//              extended by PAYMENT_PERIOD_DAYS when the same plan is still running). Applied once per reference.
//   webhook    POST /payments/korapay/webhook: x-korapay-signature checked (HMAC-SHA256 of the data object), every
//              call logged in payment_events, then confirm(). Korapay retries non-200 replies for 72 hours.
//   return     GET /account/billing/payments/:reference: the app's return page asks for the status, which
//              confirms a still-pending payment on the spot (the webhook may arrive later).
// Plans are bought one period at a time (no card auto-renewal); paying again extends the period.
const crypto = require('crypto');
const config = require('../../config');
const log = require('../../shared/logger');
const { korapay } = require('./korapay');
const { sqlStore, memoryStore } = require('./store');

const DAY = 86400000;
const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const newReference = (userId) => `CLN-${userId}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
  .toUpperCase();
const toDate = (v) => (v ? new Date(v) : null);

function create({ store = sqlStore(), provider, cfg = config.payments, billing = require('../billing'),
  now = () => new Date() } = {}) {
  const kp = provider || korapay({ secretKey: cfg.korapaySecret, baseUrl: cfg.korapayUrl });
  const enabled = () => Boolean(cfg.korapaySecret) || Boolean(provider);

  async function checkout(user, { plan: code } = {}) {
    if (!enabled()) throw err(503, 'payments_off', 'Payments are not available yet.');
    if (!billing.billable(user)) throw err(400, 'not_billable', 'This account does not need a plan.');
    if (!user.email) throw err(400, 'email_required', 'Add an email address to your account first.');
    const plan = code && await store.plan(String(code));
    if (!plan || !Number(plan.active) || plan.code === 'free') throw err(400, 'bad_plan', 'Choose a paid plan.');
    const amount = Number(plan.price_minor);
    if (!(amount > 0)) throw err(400, 'plan_not_for_sale', `The ${plan.name} plan is not on sale yet.`);
    const reference = newReference(user.id);
    await store.addPayment({ reference, user_id: user.id, plan_code: plan.code, amount_minor: amount,
      currency: plan.currency || 'NGN' });
    try {
      const data = await kp.initialize({
        amount: amount / 100, currency: plan.currency || 'NGN', reference,
        customer: { email: user.email, name: (user.name || '').slice(0, 100) || undefined },
        redirect_url: `${cfg.returnUrl}${cfg.returnUrl.includes('?') ? '&' : '?'}payment=korapay`
          + `&reference=${reference}`,
        notification_url: `${cfg.apiUrl}/payments/korapay/webhook`,
        narration: `Colon AI ${plan.name} plan`,
        channels: ['card', 'bank_transfer'],
        metadata: { user: String(user.id), plan: plan.code },
      });
      if (!data.checkout_url) throw err(502, 'provider_error', 'Korapay did not return a checkout page.');
      await store.updatePayment(reference, { checkout_url: String(data.checkout_url).slice(0, 500) });
      return { reference, checkout_url: data.checkout_url, plan: plan.code, amount_minor: amount,
        currency: plan.currency || 'NGN' };
    } catch (e) {
      await store.updatePayment(reference, { status: 'failed', failure: String(e.message).slice(0, 255) })
        .catch(() => {});
      throw e;
    }
  }

  // Asks Korapay for the charge and applies it once. -> { status, plan, period_end } or null (unknown reference).
  async function confirm(reference) {
    const known = await store.payment(reference);
    if (!known) return null;
    if (known.status !== 'pending') return view(known);
    const charge = await kp.verify(reference);
    const result = await store.tx(async (q) => {
      const p = await q.payment(reference, true);
      if (!p || p.status !== 'pending') return { payment: p, applied: false };
      const st = String(charge.status || '').toLowerCase();
      if (st === 'failed') {
        await q.updatePayment(reference, { status: 'failed', failure: 'Declined or failed at Korapay' });
        return { payment: { ...p, status: 'failed' }, applied: false };
      }
      if (st !== 'success') return { payment: p, applied: false };   // processing / pending: wait
      const paidMinor = Math.round(Number(charge.amount) * 100);
      const currency = String(charge.currency || '').toUpperCase();
      if (currency !== String(p.currency).toUpperCase() || !(paidMinor >= Number(p.amount_minor))) {
        await q.updatePayment(reference, { status: 'failed', failure: `amount_mismatch ${paidMinor} ${currency}` });
        log.warn('payment_amount_mismatch', { reference, paidMinor, expected: Number(p.amount_minor), currency });
        return { payment: { ...p, status: 'failed' }, applied: false };
      }
      const sub = await q.subscription(p.user_id);
      const t = now();
      const running = sub && sub.status === 'active' && sub.plan_code === p.plan_code && toDate(sub.period_end)
        && toDate(sub.period_end) > t;
      const start = running ? toDate(sub.period_start) || t : t;
      const end = new Date((running ? toDate(sub.period_end) : t).getTime() + cfg.periodDays * DAY);
      const fromPlan = sub && sub.status === 'active' && (!sub.period_end || toDate(sub.period_end) > t)
        ? sub.plan_code : 'free';
      await q.saveSubscription({ user_id: p.user_id, plan_code: p.plan_code, status: 'active', period_start: start,
        period_end: end, provider: 'korapay', provider_ref: reference });
      await q.updatePayment(reference, { status: 'success', paid_at: 'now',
        method: charge.payment_method ? String(charge.payment_method).slice(0, 32) : undefined,
        fee_minor: charge.fee != null ? Math.round(Number(charge.fee) * 100) : undefined });
      return { payment: { ...p, status: 'success' }, applied: true, fromPlan, end };
    });
    if (result.applied) {
      log.info('payment_applied', { reference, user: result.payment.user_id, plan: result.payment.plan_code });
      // Top up this month's credits to the new plan. Idempotent on the reference; a failure here never undoes
      // the payment (the next month grants the new plan's credits anyway).
      await billing.planChanged({ userId: result.payment.user_id, ref: reference, fromCode: result.fromPlan })
        .catch((e) => log.error('payment_credit_topup_failed', { reference, err: e.message }));
      return { ...view(result.payment), period_end: result.end };
    }
    return result.payment ? view(result.payment) : null;
  }

  // POST /payments/korapay/webhook. -> [status, body]. Bad signatures are logged and ignored (200, so Korapay
  // does not retry a forgery); a confirm that fails on our side answers 500 so Korapay retries later.
  async function webhook(body, headers) {
    const event = String((body && body.event) || '');
    const data = body && body.data;
    const reference = String((data && (data.reference || data.payment_reference)) || '');
    const ok = kp.signatureOk(data, headers['x-korapay-signature']);
    const record = (outcome) => store.addEvent({ event, reference, signature_ok: ok, outcome,
      payload: JSON.stringify(body || {}) }).catch((e) => log.warn('payment_event_log_failed', { err: e.message }));
    if (!ok) { await record('bad_signature'); log.warn('korapay_bad_signature', { event, reference }); return [200,
      { ok: false }]; }
    if (!/^charge\./.test(event) || !reference) { await record('ignored'); return [200, { ok: true }]; }
    try {
      const r = await confirm(reference);
      await record(r ? r.status : 'unknown_reference');
      return [200, { ok: true }];
    } catch (e) {
      await record('error');
      log.error('korapay_webhook_failed', { reference, err: e.message });
      return [500, { ok: false }];
    }
  }

  // GET /account/billing/payments/:reference (the owner only).
  async function status(user, reference) {
    const p = await store.payment(String(reference || ''));
    if (!p || String(p.user_id) !== String(user.id)) throw err(404, 'not_found', 'Payment not found.');
    if (p.status === 'pending' && enabled()) {
      const r = await confirm(p.reference).catch((e) => { log.warn('payment_confirm_failed', { err: e.message });
        return null; });
      if (r) return r;
    }
    return view(p);
  }

  const history = async (user, limit = 10) => (await store.payments(user.id, limit)).map(view);

  return { checkout, confirm, webhook, status, history, enabled };
}

const view = (p) => ({ reference: p.reference, plan: p.plan_code, status: p.status,
  amount_minor: Number(p.amount_minor), currency: p.currency, created_at: p.created_at, paid_at: p.paid_at || null });

let shared = null;
const instance = () => (shared || (shared = create()));

module.exports = {
  create, instance, memoryStore, newReference,
  checkout: (u, b) => instance().checkout(u, b),
  webhook: (b, h) => instance().webhook(b, h),
  status: (u, r) => instance().status(u, r),
  enabled: () => instance().enabled(),
  history: (u, l) => instance().history(u, l),
  handlers: { korapay: require('./handlers/korapay') },
};
