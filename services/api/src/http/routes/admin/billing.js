// Admin: plans, credits, payments and costs (v0.14.0): route wiring only. Handlers: modules/admin/handlers/billing.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.billing;

const r = new Router();
r.get('/admin/billing/plans', requireRole('admin'), h.getPlans);
r.patch('/admin/billing/plans/:code', requireRole('admin'), h.patchPlan);
r.get('/admin/billing/users/:id', requireRole('admin'), h.getUser);
r.post('/admin/billing/users/:id/credits', requireRole('admin'), h.postCredits);
r.post('/admin/billing/users/:id/plan', requireRole('admin'), h.postPlan);
r.get('/admin/billing/payments', requireRole('admin'), h.getPayments);
r.get('/admin/billing/costs', requireRole('admin'), h.getCosts);

module.exports = r;
