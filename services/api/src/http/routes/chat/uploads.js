// Chat: uploads and guest file extraction: route wiring only. Handlers: modules/chat/handlers/uploads.js
const Router = require('../../router');
const settings = require('../../../shared/settings');
const { requireUser } = require('../../../modules/auth').guards;
const { limit, perUser } = require('../../middleware/ratelimit');
const h = require('../../../modules/chat').handlers.uploads;

const r = new Router();
r.post('/uploads', { body: 'raw' }, requireUser, settings.feature('uploads'), perUser('upload', 60, 3600), h.postUploads);
r.get('/uploads/:id/file', requireUser, h.getUploadsByIdFile);
r.delete('/uploads/:id', requireUser, h.deleteUploadsById);
r.delete('/uploads', requireUser, h.deleteUploads);
r.post('/chat/guest/extract', { body: 'raw' }, settings.feature('uploads'), settings.feature('guestChat', { guestsOnly: true }), limit('guest-extract', 40, 3600), h.postChatGuestExtract);

module.exports = r;
