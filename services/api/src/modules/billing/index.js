// Billing (v0.12.0, Blueprint steps A1–A3): plans, entitlements and the credit ledger, enforced on the server.
//
//   plan + entitlements  plans / plan_entitlements, cached ~60 s. A user without an active subscription is Free.
//   wallet               one row per user; the first use in a new UTC month resets it to the plan's ai_credits
//                        (an 'expire' entry for what was left, then a 'grant'). No rollover.
//   reserve -> settle    every billable request reserves its credits under a unique request id before the
//                        provider is called (a retry with the same id is never charged twice), then settles to
//                        the actual charge, or is refunded when nothing was delivered.
//   ledger               insert-only; each entry carries the balance after it, so balance = SUM(amount).
//
// BILLING_MODE: off (nothing recorded) | shadow (recorded, never blocks; balances may go negative, to measure real
// usage before quotas are switched on) | enforce (requests are refused when credits run out).
// Staff (moderator and above) and guests are never charged; guests keep the daily limits in ai/limits.js.
const config = require('../../config');
const { sqlStore, memoryStore, monthRange } = require('./store');

const FEATURES = ['ai_credits', 'image_credits', 'research_tasks', 'background_jobs', 'projects', 'memory'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

const period = (now = new Date()) => now.toISOString().slice(0, 7);
function nextPeriodName(p) { const m = Number(p.slice(5, 7)); return `1 ${MONTHS[m % 12]}`; }

// Credits a request costs, from config (BILLING_CREDITS_*). Research mode searches and reads pages, so costs more.
function cost(feature, mode, cfg = config.billing) {
  if (feature === 'chat') return mode === 'research' ? cfg.credits.research : cfg.credits.chat;
  if (feature === 'saga') return cfg.credits.saga;
  return cfg.credits.chat;
}

function billable(user) { return Boolean(user && user.id && (!user.role || user.role === 'user')); }

function creditsError(planName, limit, p) {
  return Object.assign(new Error(`You’ve used this month’s ${limit} Colon credits on the ${planName} plan. `
    + `They renew on ${nextPeriodName(p)}.`), { status: 402, code: 'quota', reason: 'credits' });
}

function create({ store = sqlStore(), cfg = config.billing, now = () => new Date(), cacheMs = 60000 } = {}) {
  let cache = null;
  let cachedAt = 0;
  // Two first requests of a month can race to create the wallet (duplicate ref) or deadlock on its gap lock;
  // the transaction rolled back, so running it once more is safe and sees the winner's row.
  const RETRY = ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'];
  async function tx(fn) {
    try { return await store.tx(fn); } catch (e) { if (!RETRY.includes(e.code)) throw e; return store.tx(fn); }
  }

  async function catalogue() {
    if (cache && now() - cachedAt < cacheMs) return cache;
    const { plans, entitlements } = await store.plans();
    const byCode = {};
    for (const p of plans) byCode[p.code] = { ...p, active: Boolean(Number(p.active)), entitlements: {} };
    for (const e of entitlements) {
      if (!byCode[e.plan_code]) continue;
      byCode[e.plan_code].entitlements[e.feature] = { enabled: Boolean(Number(e.enabled)),
        limit: e.limit_value == null ? null : Number(e.limit_value) };
    }
    cache = byCode; cachedAt = now();
    return cache;
  }

  // -> the user's plan object (with .entitlements). Falls back to Free for an unknown or inactive plan.
  async function planFor(userId, q = store) {
    const all = await catalogue();
    const sub = await q.subscription(userId);
    const code = sub && all[sub.plan_code] && all[sub.plan_code].active ? sub.plan_code : 'free';
    return all[code] || { code: 'free', name: 'Free', entitlements: {} };
  }

  const monthlyCredits = (plan) => { const e = plan.entitlements.ai_credits; return e && e.enabled
    ? (e.limit == null ? Number.MAX_SAFE_INTEGER : e.limit) : 0; };

  // Inside a transaction: lock the wallet and start the new month when needed. -> { wallet, plan, period }
  async function openWallet(q, userId) {
    const p = period(now());
    const plan = await planFor(userId, q);
    let w = await q.lockWallet(userId);
    if (!w || w.period !== p) {
      const left = w ? Number(w.balance) : 0;
      const grant = monthlyCredits(plan);
      if (w && left !== 0) {
        await q.addLedger({ ref: `expire:${userId}:${w.period}`, user_id: userId, amount: -left, balance_after: 0,
          kind: 'expire', period: w.period, description: `Unused ${w.period} credits` });
      }
      w = { user_id: userId, balance: grant, period: p, plan_code: plan.code };
      await q.addLedger({ ref: `grant:${userId}:${p}`, user_id: userId, amount: grant, balance_after: grant,
        kind: 'grant', period: p, description: `${plan.name} plan credits for ${p}` });
      await q.saveWallet(w);
    }
    return { wallet: { ...w, balance: Number(w.balance) }, plan, period: p };
  }

  // Reserves credits for one request. Idempotent on requestId. -> { reserved, balance, enforced } or null when
  // billing does not apply. Throws { code:'quota', status:402 } in enforce mode when the balance is too low.
  async function reserve({ user, requestId, feature, mode = '', credits }) {
    if (cfg.mode === 'off' || !billable(user)) return null;
    if (!requestId) throw new Error('billing.reserve needs a requestId');
    const enforced = cfg.mode === 'enforce';
    const amount = credits != null ? credits : cost(feature, mode, cfg);
    return tx(async (q) => {
      const seen = await q.usage(requestId, true);
      if (seen) return { reserved: Number(seen.credits_reserved), balance: null, enforced, replay: true };
      const { wallet, plan, period: p } = await openWallet(q, user.id);
      const ent = plan.entitlements.ai_credits;
      if (enforced && (!ent || !ent.enabled || wallet.balance < amount)) {
        throw creditsError(plan.name, ent && ent.limit != null ? ent.limit : 0, p);
      }
      const balance = wallet.balance - amount;
      await q.addUsage({ request_id: requestId, user_id: user.id, feature, mode, plan_code: plan.code,
        credits_reserved: amount, enforced });
      await q.addLedger({ ref: `use:${requestId}`, user_id: user.id, amount: -amount, balance_after: balance,
        kind: 'usage', period: p, description: mode ? `${feature} (${mode})` : feature });
      await q.saveWallet({ ...wallet, balance });
      return { reserved: amount, balance, enforced };
    });
  }

  // Settles a reservation to what was actually charged (default: the reserved amount). Safe to call twice.
  async function settle({ user, requestId, credits, provider, model, inputTokens, outputTokens }) {
    if (cfg.mode === 'off' || !billable(user) || !requestId) return null;
    return tx(async (q) => {
      const u = await q.usage(requestId, true);
      if (!u || u.status !== 'reserved') return null;
      const reserved = Number(u.credits_reserved);
      const charged = credits == null ? reserved : Math.max(0, Math.floor(credits));
      const diff = reserved - charged;   // > 0: give some back; < 0: charge the extra
      if (diff !== 0) {
        const { wallet, period: p } = await openWallet(q, user.id);
        const balance = wallet.balance + diff;
        await q.addLedger({ ref: `settle:${requestId}`, user_id: user.id, amount: diff, balance_after: balance,
          kind: 'settle', period: p, description: 'Adjusted to actual usage' });
        await q.saveWallet({ ...wallet, balance });
      }
      await q.updateUsage(requestId, { status: 'settled', credits_charged: charged, provider, model,
        input_tokens: inputTokens, output_tokens: outputTokens });
      return { charged };
    });
  }

  // Gives a reservation back in full (nothing was delivered). Safe to call twice.
  async function refund({ user, requestId, reason = 'Not delivered' }) {
    if (cfg.mode === 'off' || !billable(user) || !requestId) return null;
    return tx(async (q) => {
      const u = await q.usage(requestId, true);
      if (!u || u.status !== 'reserved') return null;
      const amount = Number(u.credits_reserved);
      const { wallet, period: p } = await openWallet(q, user.id);
      const balance = wallet.balance + amount;
      await q.addLedger({ ref: `refund:${requestId}`, user_id: user.id, amount, balance_after: balance,
        kind: 'refund', period: p, description: reason });
      await q.saveWallet({ ...wallet, balance });
      await q.updateUsage(requestId, { status: 'refunded', credits_charged: 0 });
      return { refunded: amount };
    });
  }

  // Monthly cap check for a counted feature (research_tasks, background_jobs, image_credits…).
  // -> { allowed, limit, used, remaining }. limit null = no cap.
  async function checkQuota(user, feature) {
    if (!billable(user)) return { allowed: true, limit: null, used: 0, remaining: null };
    const plan = await planFor(user.id);
    const ent = plan.entitlements[feature];
    if (!ent || !ent.enabled) return { allowed: cfg.mode !== 'enforce', limit: 0, used: 0, remaining: 0 };
    if (ent.limit == null) return { allowed: true, limit: null, used: 0, remaining: null };
    const used = await store.monthCount(user.id, feature, period(now()));
    const remaining = Math.max(0, ent.limit - used);
    return { allowed: cfg.mode !== 'enforce' || remaining > 0, limit: ent.limit, used, remaining };
  }

  // GET /account/billing: the user's plan, this month's credits and recent ledger entries.
  async function summary(user, { ledgerLimit = 20 } = {}) {
    const all = await catalogue();
    if (!billable(user)) {
      return { mode: cfg.mode, billable: false, plans: publicPlans(all) };
    }
    const state = await tx((q) => openWallet(q, user.id));
    const ledger = await store.ledger(user.id, ledgerLimit);
    return {
      mode: cfg.mode, billable: true,
      plan: { code: state.plan.code, name: state.plan.name, entitlements: state.plan.entitlements },
      credits: { balance: state.wallet.balance, monthly: monthlyCredits(state.plan), period: state.period,
        renews: nextPeriodName(state.period) },
      ledger: ledger.map((e) => ({ amount: Number(e.amount), balance_after: Number(e.balance_after), kind: e.kind,
        description: e.description, created_at: e.created_at })),
      plans: publicPlans(all),
    };
  }

  return { reserve, settle, refund, checkQuota, summary, planFor, catalogue,
    _clearCache() { cache = null; } };
}

const publicPlans = (all) => Object.values(all).filter((p) => p.active).sort((a, b) => a.sort - b.sort)
  .map((p) => ({ code: p.code, name: p.name, price_minor: Number(p.price_minor), currency: p.currency,
    entitlements: p.entitlements }));

let shared = null;
const instance = () => (shared || (shared = create()));

module.exports = {
  create, instance, cost, billable, period, nextPeriodName, monthRange, memoryStore, FEATURES,
  reserve: (o) => instance().reserve(o),
  settle: (o) => instance().settle(o),
  refund: (o) => instance().refund(o),
  checkQuota: (u, f) => instance().checkQuota(u, f),
  summary: (u, o) => instance().summary(u, o),
};
