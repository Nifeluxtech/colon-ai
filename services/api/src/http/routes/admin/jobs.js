// Admin: background jobs and the cron (v0.16.0): route wiring only. Handlers: modules/admin/handlers/jobs.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.jobs;

const r = new Router();
r.get('/admin/jobs', requireRole('admin'), h.getJobs);
r.post('/admin/jobs/:id/retry', requireRole('admin'), h.postRetry);
r.post('/admin/jobs/:id/cancel', requireRole('admin'), h.postCancel);

module.exports = r;
