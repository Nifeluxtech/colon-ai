// Crash Predictor (v0.33.0, step 1): route wiring only. Handlers: modules/crash/index.js
// Signed-in Colon users only; every call acts on req.user's own settings, rounds and bets.
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/crash').handlers;

const r = new Router();
r.get('/crash/dashboard', requireUser, h.getDashboard);
r.get('/crash/settings', requireUser, h.getSettings);
r.put('/crash/settings', requireUser, perUser('crash-settings', 120, 3600), h.putSettings);
r.get('/crash/rounds', requireUser, h.getRounds);
r.get('/crash/bets', requireUser, h.getBets);

module.exports = r;
