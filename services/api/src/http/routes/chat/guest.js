// Chat: guest (and temporary) chat stream: route wiring only. Handlers: modules/chat/handlers/guest.js
const Router = require('../../router');
const settings = require('../../../shared/settings');
const { limit } = require('../../middleware/ratelimit');
const { guestOrigin } = require('../../middleware/origin');
const h = require('../../../modules/chat').handlers.guest;

const r = new Router();
r.post('/chat/guest', { bodyLimit: 1024 * 1024 }, guestOrigin, settings.feature('guestChat', { guestsOnly: true }),
  limit('guest-chat', 20, 60), h.postChatGuest);

module.exports = r;
