// Admin: usage limits: route wiring only. Handlers: modules/admin/handlers/limits.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.limits;

const r = new Router();
r.get('/admin/limits', requireRole('admin'), h.getAdminLimits);
r.patch('/admin/limits', requireRole('admin'), h.patchAdminLimits);

module.exports = r;
