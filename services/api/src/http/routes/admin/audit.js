// Admin: audit log and security: route wiring only. Handlers: modules/admin/handlers/audit.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.audit;

const r = new Router();
r.get('/admin/audit', requireRole('admin'), h.getAdminAudit);
r.get('/admin/security', requireRole('admin'), h.getAdminSecurity);

module.exports = r;
