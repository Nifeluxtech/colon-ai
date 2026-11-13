// Study: CBT practice test: route wiring only. Handlers: modules/study/handlers/cbt.js
// Open to guests (when guest chat is on) and signed-in users; 5 tests per 10 minutes per IP, plus the daily limits.
const Router = require('../router');
const settings = require('../../shared/settings');
const { limit } = require('../middleware/ratelimit');
const { guestOrigin } = require('../middleware/origin');
const h = require('../../modules/study').handlers.cbt;

const r = new Router();
r.post('/study/cbt', guestOrigin, settings.feature('guestChat', { guestsOnly: true }), limit('study-cbt', 5, 600),
  (req, res) => h.postCbt(req, res));

module.exports = r;
