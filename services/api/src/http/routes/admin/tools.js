// Admin: the tool registry, read-only (v0.17.0): route wiring only. Handler: modules/admin/handlers/tools.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.tools;

const r = new Router();
r.get('/admin/tools', requireRole('admin'), h.getTools);

module.exports = r;
