// Voice: speech to text for the mic button: route wiring only. Handlers: modules/voice/handlers.js
// Signed-in users: 60 recordings an hour. Guests (when guest chat is on): 20 an hour per IP, own origins only.
const Router = require('../router');
const settings = require('../../shared/settings');
const { limit, hit } = require('../middleware/ratelimit');
const { guestOrigin } = require('../middleware/origin');
const h = require('../../modules/voice').handlers;

const perCaller = async (req) => {
  if (req.user) return hit(`voice:u${req.user.id}`, 60, 3600);
  guestOrigin(req);
  return hit(`voice-guest:${req.ip}`, 20, 3600);
};

const r = new Router();
r.get('/voice/status', limit('voice-status', 120, 600), h.getStatus);
r.post('/voice/transcribe', { body: 'raw' }, settings.feature('guestChat', { guestsOnly: true }), perCaller,
  h.postTranscribe);

module.exports = r;
