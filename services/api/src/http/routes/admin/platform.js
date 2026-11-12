// Admin: African AI registry, voice and system settings: route wiring only. Handlers: modules/admin/handlers/platform.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.platform;

const r = new Router();
r.get('/admin/registry', requireRole('admin'), h.getAdminRegistry);
r.post('/admin/registry', requireRole('admin'), h.postAdminRegistry);
r.patch('/admin/registry/:id', requireRole('admin'), h.patchAdminRegistryById);
r.delete('/admin/registry/:id', requireRole('admin'), h.deleteAdminRegistryById);
r.get('/admin/voice', requireRole('admin'), h.getAdminVoice);
r.patch('/admin/voice', requireRole('admin'), h.patchAdminVoice);
r.get('/admin/system', requireRole('super_admin'), h.getAdminSystem);
r.patch('/admin/system', requireRole('super_admin'), h.patchAdminSystem);

module.exports = r;
