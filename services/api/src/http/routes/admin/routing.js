// Admin: live routing: route wiring only. Handlers: modules/admin/handlers/routing.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.routing;

const r = new Router();
r.get('/admin/routing', requireRole('admin'), h.getAdminRouting);
r.patch('/admin/routing', requireRole('admin'), h.patchAdminRouting);
r.delete('/admin/routing', requireRole('admin'), h.deleteAdminRouting);

module.exports = r;
