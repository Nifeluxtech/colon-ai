// Image generation in chat (v0.17.0, Blueprint D15): route wiring only. Handler: modules/media/index.js
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const media = require('../../modules/media');

const r = new Router();
r.post('/conversations/:id/images', requireUser, perUser('chat-image', 10, 600),
  media.handlers.postConversationsByIdImages);

module.exports = r;
