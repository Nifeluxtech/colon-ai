// Admin: Safety (events and settings): route wiring only. Handlers: modules/admin/handlers/safety.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.safety;

const r = new Router();
r.get('/admin/safety', requireRole('admin'), h.getAdminSafety);
r.get('/admin/safety/settings', requireRole('admin'), h.getAdminSafetySettings);
r.patch('/admin/safety/settings', requireRole('admin'), h.patchAdminSafetySettings);

module.exports = r;
