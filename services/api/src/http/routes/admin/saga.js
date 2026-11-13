// Admin: Saga browsing tasks and their replay (Phase 9): route wiring only. Handlers: modules/saga/handlers/admin.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/saga').handlers.admin;

const r = new Router();
r.get('/admin/saga/tasks', requireRole('admin'), h.getAdminSagaTasks);
r.get('/admin/saga/tasks/:id', requireRole('admin'), h.getAdminSagaTask);

module.exports = r;
