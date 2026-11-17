// Billing admin (v0.14.0, Blueprint steps A6 and A7): what Admin › Plans, Credits, Payments and Costs do.
//
//   plans      list and edit name, price (kobo), active, sort and the monthly allowances. The plan cache of the credit
//              engine is cleared after every edit (other workers pick the change up within its ~60 s cache).
//              The Free plan always costs 0 and cannot be switched off.
//   credits    a manual grant (+) or revoke (−) is one ledger entry, kind 'grant' or 'revoke', written in the same
//              transaction as the wallet with the row locked. Idempotent on the admin's key (ref admin:<user>:<key>):
//              a retried request returns the first result. A revoke never takes the balance below 0 (it is clipped).
//   plan       set or comp a plan for N days (subscription provider 'admin'), then top this month's credits up the
//              same way a paid upgrade does. Setting Free cancels the subscription.
//   costs      spend (kobo) and tokens from ai_calls per UTC day, model, plan and user, and today's spend against
//              BILLING_DAILY_SPEND_CAP_MINOR (warn at 80 %, over at 100 %). Display only: nothing is ever blocked.
// The HTTP layer (modules/admin/handlers/billing.js) checks roles and writes the audit log with the reason.
const crypto = require('crypto');
const config = require('../../config');
const { sqlAdminStore, DAY } = require('./admin-store');

const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });
const STATUSES = ['', 'pending', 'success', 'failed', 'abandoned'];
const int = (x, field, min, max, msg) => {
  const k = Number(x);
  if (x === '' || x === null || typeof x === 'boolean' || !Number.isInteger(k) || k < min || k > max) {
    throw err(422, 'invalid', msg || `Use a whole number from ${min} to ${max}.`, field);
  }
  return k;
};

function reasonOf(r) {
  const s = String(r == null ? '' : r).trim().replace(/\s+/g, ' ');
  if (s.length < 3) throw err(422, 'invalid', 'Give a reason (kept in the audit log).', 'reason');
  return s.slice(0, 300);
}
function keyOf(k) {
  if (k == null || k === '') return crypto.randomBytes(8).toString('hex');
  const s = String(k);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(s)) throw err(422, 'invalid', 'Bad request key.', 'key');
  return s;
}

// Today's spend against the daily cap (kobo). -> { cap_minor, spend_minor, pct, level: off | ok | warn | over }
function capStatus(spend, cap) {
  const s = Number(spend) || 0;
  if (!(Number(cap) > 0)) return { cap_minor: 0, spend_minor: s, pct: null, level: 'off' };
  const pct = Math.round(s / Number(cap) * 1000) / 10;
  return { cap_minor: Number(cap), spend_minor: s, pct, level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok' };
}

const totalsOf = (r) => ({ calls: Number(r.calls) || 0, input_tokens: Number(r.input_tokens) || 0,
  output_tokens: Number(r.output_tokens) || 0, cost_minor: Math.round((Number(r.cost_minor) || 0) * 10000) / 10000 });

function create({ engine, store = sqlAdminStore(), cfg = config.billing, now = () => new Date() } = {}) {
  const { FEATURES } = require('./index');
  const planView = (p) => ({ code: p.code, name: p.name, price_minor: Number(p.price_minor), currency: p.currency,
    active: Boolean(p.active), sort: Number(p.sort), entitlements: p.entitlements });

  async function listPlans() {
    const all = await engine.catalogue();
    return { plans: Object.values(all).sort((a, b) => a.sort - b.sort).map(planView), features: FEATURES };
  }

  async function updatePlan(code, b = {}) {
    engine._clearCache();
    const cur = (await engine.catalogue())[code];
    if (!cur) throw err(404, 'not_found', 'Plan not found.');
    const f = {}, changes = {};
    const set = (k, v, from) => { if (v !== from) { f[k] = v; changes[k] = { from, to: v }; } };
    if (b.name !== undefined) {
      const name = String(b.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 1 || name.length > 60) throw err(422, 'invalid', 'Use a name of 1 to 60 characters.', 'name');
      set('name', name, cur.name);
    }
    if (b.price_minor !== undefined) {
      const price = int(b.price_minor, 'price_minor', 0, 100000000000, 'Use a price of 0 or more (in kobo).');
      if (code === 'free' && price !== 0) throw err(422, 'invalid', 'The Free plan always costs 0.', 'price_minor');
      set('price_minor', price, Number(cur.price_minor));
    }
    if (b.active !== undefined) {
      const active = b.active === true || b.active === 1 || b.active === '1' || b.active === 'true';
      if (code === 'free' && !active) throw err(422, 'invalid', 'The Free plan cannot be switched off.', 'active');
      set('active', active, Boolean(cur.active));
    }
    if (b.sort !== undefined) set('sort', int(b.sort, 'sort', -1000, 1000), Number(cur.sort));
    const ents = [];
    if (b.entitlements && typeof b.entitlements === 'object') {
      for (const [feature, v] of Object.entries(b.entitlements)) {
        if (!FEATURES.includes(feature)) throw err(422, 'invalid', `Unknown allowance: ${feature}.`, 'entitlements');
        const was = cur.entitlements[feature] || { enabled: false, limit: null };
        const e = v && typeof v === 'object' ? v : { limit: v };
        const enabled = e.enabled === undefined ? (cur.entitlements[feature] ? was.enabled : true) : Boolean(e.enabled);
        const limit = e.limit === undefined ? was.limit : e.limit === null || e.limit === ''
          ? null : int(e.limit, `entitlements.${feature}`, 0, 1000000000);
        const has = Boolean(cur.entitlements[feature]);
        if (has ? enabled !== was.enabled || limit !== was.limit : enabled || limit !== null) {
          ents.push([feature, { enabled, limit }]);
          changes[`entitlements.${feature}`] = { from: has ? was : null, to: { enabled, limit } };
        }
      }
    }
    if (!Object.keys(changes).length) throw err(422, 'invalid', 'Nothing to change.');
    if (Object.keys(f).length) await store.updatePlan(code, { ...f, ...(f.active !== undefined
      ? { active: f.active ? 1 : 0 } : {}) });
    for (const [feature, e] of ents) await store.setEntitlement(code, feature, e);
    engine._clearCache();
    return { plan: planView((await engine.catalogue())[code]), changes };
  }

  async function findUser(key) {
    const u = key == null || key === '' ? null : await store.user(String(key).trim());
    if (!u) throw err(404, 'not_found', 'User not found.');
    return u;
  }

  async function userView(key) {
    const u = await findUser(key);
    const st = await engine.walletTx(u.id, async (q, s) => s);
    const [ledger, sub, payments] = await Promise.all([engine.store.ledger(u.id, 25), store.subscriptionRow(u.id),
      store.payments({ userId: u.id, limit: 10 })]);
    return {
      user: { id: Number(u.id), email: u.email, name: u.name || '', role: u.role || 'user' },
      billable: !u.role || u.role === 'user', mode: cfg.mode,
      plan: { code: st.plan.code, name: st.plan.name },
      subscription: sub ? { plan: sub.plan_code, status: sub.status, period_start: sub.period_start || null,
        period_end: sub.period_end || null, provider: sub.provider || null } : null,
      credits: { balance: st.wallet.balance, monthly: engine.monthlyCredits(st.plan), period: st.period },
      ledger: ledger.map((e) => ({ amount: Number(e.amount), balance_after: Number(e.balance_after), kind: e.kind,
        description: e.description, created_at: e.created_at })),
      payments: payments.map(paymentView),
    };
  }

  // -> { amount (applied), requested, balance, kind, ref, replay? }
  async function adjustCredits(userId, b = {}, actorId = null) {
    const amount = int(b.amount, 'amount', -10000000, 10000000, 'Use a whole number of credits (+ to grant, − to '
      + 'revoke).');
    if (amount === 0) throw err(422, 'invalid', 'Use a number other than 0.', 'amount');
    const reason = reasonOf(b.reason);
    const u = await findUser(userId);
    const ref = `admin:${u.id}:${keyOf(b.key)}`;
    const replay = async () => {
      const seen = await engine.store.ledgerRef(ref);
      return seen ? { amount: Number(seen.amount), requested: amount, balance: Number(seen.balance_after),
        kind: Number(seen.amount) > 0 ? 'grant' : 'revoke', ref, replay: true } : null;
    };
    const first = await replay();
    if (first) return first;
    try {
      return await engine.walletTx(u.id, async (q, { wallet, period }) => {
        const delta = amount > 0 ? amount : -Math.min(-amount, Math.max(0, wallet.balance));
        if (delta === 0) throw err(409, 'nothing_to_revoke', 'This user has no credits left to revoke.');
        const balance = wallet.balance + delta;
        const kind = delta > 0 ? 'grant' : 'revoke';
        await q.addLedger({ ref, user_id: u.id, amount: delta, balance_after: balance, kind, period,
          description: `Admin ${kind}: ${reason}`, created_by: actorId });
        await q.saveWallet({ ...wallet, balance });
        return { amount: delta, requested: amount, balance, kind, ref, reason };
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') { const r = await replay(); if (r) return r; }
      throw e;
    }
  }

  // -> { plan, from, period_end, added, balance, replay? }
  async function setPlan(userId, b = {}, actorId = null) {
    const reason = reasonOf(b.reason);
    const all = await engine.catalogue();
    const plan = all[String(b.plan || '')];
    if (!plan || !plan.active) throw err(422, 'invalid', 'Choose an active plan.', 'plan');
    const days = plan.code === 'free' ? 0 : int(b.days, 'days', 1, 3650, 'Use 1 to 3650 days.');
    const u = await findUser(userId);
    const ref = `admin:${u.id}:${keyOf(b.key)}`;
    const row = await store.subscriptionRow(u.id);
    if (row && row.provider_ref === ref) {
      return { plan: row.plan_code, from: null, period_end: row.period_end || null, added: 0, replay: true };
    }
    const from = (await engine.planFor(u.id)).code;
    const t = now();
    const end = plan.code === 'free' ? t : new Date(t.getTime() + days * DAY);
    await engine.store.tx((q) => q.saveSubscription({ user_id: u.id, plan_code: plan.code,
      status: plan.code === 'free' ? 'cancelled' : 'active', period_start: t, period_end: end, provider: 'admin',
      provider_ref: ref }));
    engine._clearCache();
    const top = await engine.planChanged({ userId: u.id, ref, fromCode: from });
    return { plan: plan.code, from, period_end: end, days, added: top ? top.added : 0,
      balance: top ? top.balance : null, reason, actor: actorId };
  }

  async function payments({ status = '', limit = 50 } = {}) {
    const st = String(status || '');
    if (!STATUSES.includes(st)) throw err(422, 'invalid', 'Unknown payment status.', 'status');
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    return { payments: (await store.payments({ status: st, limit: lim })).map(paymentView), status: st };
  }

  async function costs({ days = 7 } = {}) {
    const n = Math.min(30, Math.max(1, Math.floor(Number(days)) || 7));
    const t = now();
    const today = t.toISOString().slice(0, 10);
    const list = [];
    for (let i = n - 1; i >= 0; i--) list.push(new Date(t.getTime() - i * DAY).toISOString().slice(0, 10));
    const raw = await store.costs({ since: `${list[0]} 00:00:00`, today: `${today} 00:00:00` });
    const byDayMap = new Map(raw.byDay.map((d) => [String(d.day).slice(0, 10), totalsOf(d)]));
    const byDay = list.map((day) => ({ day, ...(byDayMap.get(day) || totalsOf({})) }));
    const totals = byDay.reduce((a, d) => totalsOf({ calls: a.calls + d.calls,
      input_tokens: a.input_tokens + d.input_tokens, output_tokens: a.output_tokens + d.output_tokens,
      cost_minor: a.cost_minor + d.cost_minor }), totalsOf({}));
    const todayTotals = totalsOf(raw.today || {});
    return {
      days: n, since: list[0], priced: Boolean(String(cfg.modelCosts || '').trim()),
      today: { day: today, ...todayTotals, cap: capStatus(todayTotals.cost_minor, cfg.dailySpendCapMinor) },
      totals, byDay,
      byModel: raw.byModel.map((m) => ({ provider: m.provider, model: m.model, ...totalsOf(m) })),
      byPlan: raw.byPlan.map((p) => ({ plan: p.plan, ...totalsOf(p) })),
      topUsers: raw.topUsers.map((x) => ({ user_id: Number(x.user_id), email: x.email || null, ...totalsOf(x) })),
    };
  }

  return { listPlans, updatePlan, userView, adjustCredits, setPlan, payments, costs, findUser };
}

const paymentView = (p) => ({ reference: p.reference, user_id: p.user_id != null ? Number(p.user_id) : undefined,
  email: p.email, plan: p.plan_code, amount_minor: Number(p.amount_minor), currency: p.currency, status: p.status,
  method: p.method || null, failure: p.failure || null, created_at: p.created_at, paid_at: p.paid_at || null });

module.exports = { create, capStatus, reasonOf };
