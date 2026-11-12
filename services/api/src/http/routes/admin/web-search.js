// Admin: web search settings: route wiring only. Handlers: modules/admin/handlers/web-search.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.webSearch;

const r = new Router();
r.get('/admin/search', requireRole('super_admin'), h.getAdminSearch);
r.patch('/admin/search', requireRole('super_admin'), h.patchAdminSearch);
r.post('/admin/search/key', requireRole('super_admin'), h.postAdminSearchKey);

module.exports = r;
