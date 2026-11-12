// Admin: moderation queue: route wiring only. Handlers: modules/admin/handlers/moderation.js
const Router = require('../../router');
const { requireRole } = require('../../../modules/auth').guards;
const h = require('../../../modules/admin').handlers.moderation;

const r = new Router();
r.get('/admin/moderation', requireRole('moderator'), h.getAdminModeration);
r.get('/admin/moderation/:id', requireRole('moderator'), h.getAdminModerationById);
r.post('/admin/moderation/:id/resolve', requireRole('moderator'), h.postAdminModerationByIdResolve);
r.post('/admin/moderation/:id/dismiss', requireRole('moderator'), h.postAdminModerationByIdDismiss);
r.post('/admin/moderation/:id/reopen', requireRole('moderator'), h.postAdminModerationByIdReopen);

module.exports = r;
