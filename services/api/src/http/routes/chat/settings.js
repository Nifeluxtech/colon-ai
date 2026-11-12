// Chat: settings and stats: route wiring only. Handlers: modules/chat/handlers/settings.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const h = require('../../../modules/chat').handlers.settings;

const r = new Router();
r.get('/chat/settings', requireUser, h.getChatSettings);
r.patch('/chat/settings', requireUser, h.patchChatSettings);
r.get('/chat/stats', requireUser, h.getChatStats);

module.exports = r;
