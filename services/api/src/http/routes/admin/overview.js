// Admin: stats and overview: route wiring only. Handlers: modules/admin/handlers/overview.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.overview;

const r = new Router();
r.get('/admin/stats', requireRole('admin'), h.getAdminStats);
r.get('/admin/overview', requireRole('admin'), h.getAdminOverview);

module.exports = r;
