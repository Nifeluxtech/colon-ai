// Colon Music (OS Assistant Step 3): route wiring only. Handler: modules/music/index.js
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const music = require('../../modules/music');

const r = new Router();
r.get('/music/search', requireUser, perUser('music-search', 60, 3600), music.handlers.getSearch);

module.exports = r;
