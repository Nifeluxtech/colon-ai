// Admin: evaluation and benchmark runs: route wiring only. Handlers: modules/admin/handlers/evaluation.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.evaluation;

const r = new Router();
r.get('/admin/evaluation', requireRole('admin'), h.getAdminEvaluation);
r.post('/admin/evaluation/runs', requireRole('admin'), h.postAdminEvaluationRuns);
r.post('/admin/evaluation/bench', requireRole('admin'), h.postAdminEvaluationBench);
r.delete('/admin/evaluation/runs/:id', requireRole('admin'), h.deleteAdminEvaluationRunsById);

module.exports = r;
