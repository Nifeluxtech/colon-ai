// Admin: AI providers and models: route wiring only. Handlers: modules/admin/handlers/ai.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.ai;

const r = new Router();
r.get('/admin/providers', requireRole('admin'), h.getAdminProviders);
r.post('/admin/providers', requireRole('admin'), h.postAdminProviders);
r.patch('/admin/providers/:id', requireRole('admin'), h.patchAdminProvidersById);
r.post('/admin/providers/:id/key', requireRole('super_admin'), h.postAdminProvidersByIdKey);
r.delete('/admin/providers/:id', requireRole('admin'), h.deleteAdminProvidersById);
r.get('/admin/models', requireRole('admin'), h.getAdminModels);
r.post('/admin/models/seed', requireRole('admin'), h.postAdminModelsSeed);
r.post('/admin/models', requireRole('admin'), h.postAdminModels);
r.patch('/admin/models/:id', requireRole('admin'), h.patchAdminModelsById);
r.delete('/admin/models/:id', requireRole('admin'), h.deleteAdminModelsById);

module.exports = r;
