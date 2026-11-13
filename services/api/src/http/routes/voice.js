// Voice: speech to text for the mic button: route wiring only. Handlers: modules/voice/handlers.js
// Speech to text: 60 recordings an hour signed in; guests (when guest chat is on) 20 an hour per IP, own origins.
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

// Read aloud: one request per reply chunk (<= 900 characters). 300 chunks an hour signed in, 60 for guests.
const perSpeaker = async (req) => {
  if (req.user) return hit(`tts:u${req.user.id}`, 300, 3600);
  guestOrigin(req);
  return hit(`tts-guest:${req.ip}`, 60, 3600);
};

const r = new Router();
r.get('/voice/status', limit('voice-status', 120, 600), h.getStatus);
r.post('/voice/transcribe', { body: 'raw' }, settings.feature('guestChat', { guestsOnly: true }), perCaller,
  h.postTranscribe);
r.post('/voice/speak', settings.feature('guestChat', { guestsOnly: true }), perSpeaker, h.postSpeak);

module.exports = r;
