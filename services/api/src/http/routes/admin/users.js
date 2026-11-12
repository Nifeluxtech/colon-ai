// Admin: users: route wiring only. Handlers: modules/admin/handlers/users.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.users;

const r = new Router();
r.get('/admin/users', requireRole('moderator'), h.getAdminUsers);
r.get('/admin/users/:id', requireRole('moderator'), h.getAdminUsersById);
r.patch('/admin/users/:id/role', requireRole('admin'), h.patchAdminUsersByIdRole);
r.post('/admin/users/:id/unlock', requireRole('admin'), h.postAdminUsersByIdUnlock);
r.post('/admin/users/:id/signout', requireRole('admin'), h.postAdminUsersByIdSignout);
r.delete('/admin/users/:id/sessions/:sid', requireRole('admin'), h.deleteAdminUsersByIdSessionsBySid);
r.post('/admin/users/:id/suspend', requireRole('admin'), h.postAdminUsersByIdSuspend);
r.post('/admin/users/:id/unsuspend', requireRole('admin'), h.postAdminUsersByIdUnsuspend);
r.patch('/admin/users/:id/limit', requireRole('admin'), h.patchAdminUsersByIdLimit);

module.exports = r;
