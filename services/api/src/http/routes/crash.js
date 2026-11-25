// Crash Predictor (v0.33.0, step 1; rounds and sessions v0.35.0, step 3): route wiring only. Handlers:
// modules/crash/index.js. Signed-in Colon users only; every call acts on req.user's own settings, rounds and bets.
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/crash').handlers;

const r = new Router();
r.get('/crash/dashboard', requireUser, h.getDashboard);
r.get('/crash/settings', requireUser, h.getSettings);
r.put('/crash/settings', requireUser, perUser('crash-settings', 120, 3600), h.putSettings);
r.get('/crash/rounds', requireUser, h.getRounds);
// The collector posts a small batch every few seconds while JetX runs (a round every ~10 s): 1500 an hour.
r.post('/crash/rounds', requireUser, perUser('crash-rounds', 1500, 3600), h.postRounds);
r.post('/crash/rounds/import', { bodyLimit: 512 * 1024 }, requireUser, perUser('crash-import', 30, 3600),
  h.importRounds);
r.post('/crash/sessions', requireUser, perUser('crash-sessions', 120, 3600), h.postSession);
r.get('/crash/bets', requireUser, h.getBets);

module.exports = r;
