// Admin: plans, credits, payments and costs (v0.14.0, Blueprint A6–A7; handlers for routes/admin/billing.js).
// Admin and Super Admin only (route guards). Every change needs a reason and is written to the audit log with the
// acting admin; the work itself is in modules/billing/admin.js. Nobody changes their own credits or plan.

const audit = require('../../../shared/audit');
const billing = require('../../billing');
const { deny } = require('../../auth').guards;

const svc = () => billing.admin();
const notSelf = (req) => { if (String(req.params.id) === String(req.user.id)) deny(409, 'self',
  "You can't change your own credits or plan."); };

// GET /admin/billing/plans
const getPlans = async () => [200, await svc().listPlans()];

// PATCH /admin/billing/plans/:code {name?, price_minor?, active?, sort?, entitlements?, reason}
const patchPlan = async (req) => {
  const reason = billing.adminReason(req.body.reason);
  const r = await svc().updatePlan(String(req.params.code), req.body);
  await audit(req, 'admin.plan_updated', { actorId: req.user.id, targetType: 'plan', targetId: r.plan.code,
    meta: { reason, changes: r.changes } });
  return [200, { ok: true, plan: r.plan }];
};

// GET /admin/billing/users/:id   (:id = user id or email)
const getUser = async (req) => {
  const r = await svc().userView(req.params.id);
  await audit(req, 'admin.billing_viewed', { actorId: req.user.id, targetType: 'user', targetId: r.user.id });
  return [200, r];
};

// POST /admin/billing/users/:id/credits {amount, reason, key}
const postCredits = async (req) => {
  notSelf(req);
  const r = await svc().adjustCredits(req.params.id, req.body, req.user.id);
  if (!r.replay) {
    await audit(req, r.kind === 'grant' ? 'admin.credits_granted' : 'admin.credits_revoked', { actorId: req.user.id,
      targetType: 'user', targetId: req.params.id, meta: { amount: r.amount, requested: r.requested,
        balance: r.balance, reason: r.reason, ref: r.ref } });
  }
  return [200, { ok: true, amount: r.amount, balance: r.balance, kind: r.kind, replay: Boolean(r.replay) }];
};

// POST /admin/billing/users/:id/plan {plan, days, reason, key}
const postPlan = async (req) => {
  notSelf(req);
  const r = await svc().setPlan(req.params.id, req.body, req.user.id);
  if (!r.replay) {
    await audit(req, 'admin.plan_set', { actorId: req.user.id, targetType: 'user', targetId: req.params.id,
      meta: { plan: r.plan, from: r.from, days: r.days, period_end: r.period_end, added: r.added,
        reason: r.reason } });
  }
  return [200, { ok: true, plan: r.plan, period_end: r.period_end, added: r.added, replay: Boolean(r.replay) }];
};

// GET /admin/billing/payments?status=&limit=
const getPayments = async (req) => [200, await svc().payments({ status: req.query.get('status') || '',
  limit: req.query.get('limit') })];

// GET /admin/billing/costs?days=N
const getCosts = async (req) => [200, await svc().costs({ days: req.query.get('days') || 7 })];

module.exports = { getPlans, patchPlan, getUser, postCredits, postPlan, getPayments, getCosts };
