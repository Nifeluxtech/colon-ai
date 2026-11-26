// Crash Predictor (v0.33.0, step 1; rounds and sessions v0.35.0, step 3; analysis v0.36.0, step 4; auto-bet
// v0.37.0, step 5): route wiring.
// Handlers: modules/crash/index.js. Signed-in Colon users only; every call acts on req.user's own settings, rounds
// and bets.
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/crash').handlers;

const r = new Router();
r.get('/crash/dashboard', requireUser, h.getDashboard);
r.get('/crash/analysis', requireUser, perUser('crash-analysis', 600, 3600), h.getAnalysis);
r.get('/crash/settings', requireUser, h.getSettings);
r.put('/crash/settings', requireUser, perUser('crash-settings', 120, 3600), h.putSettings);
r.get('/crash/rounds', requireUser, h.getRounds);
// The collector posts a small batch every few seconds while JetX runs (a round every ~10 s): 1500 an hour.
r.post('/crash/rounds', requireUser, perUser('crash-rounds', 1500, 3600), h.postRounds);
r.post('/crash/rounds/import', { bodyLimit: 512 * 1024 }, requireUser, perUser('crash-import', 30, 3600),
  h.importRounds);
r.post('/crash/sessions', requireUser, perUser('crash-sessions', 120, 3600), h.postSession);
r.get('/crash/bets', requireUser, h.getBets);
// Step 5: the app asks before each round (a round every ~10 s, a Shared dry run and its confirm: 1,200 an hour).
r.get('/crash/autobet', requireUser, perUser('crash-autobet-read', 1200, 3600), h.getAutobet);
r.post('/crash/autobet', requireUser, perUser('crash-autobet', 1200, 3600), h.postAutobet);
// The kill switch is never rate-limited: STOP must always get through.
r.post('/crash/autobet/stop', requireUser, h.stopAutobet);
// The side panel and the full-screen bubble refresh after each round (and every 15 s): 1,500 an hour.
r.get('/crash/live', requireUser, perUser('crash-live', 1500, 3600), h.getLive);
r.post('/crash/bets', requireUser, perUser('crash-bets', 1200, 3600), h.postBet);
r.post('/crash/bets/:id/settle', requireUser, perUser('crash-settle', 1200, 3600), h.settleBet);

module.exports = r;
