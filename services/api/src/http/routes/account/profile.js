// Account: profile and password: route wiring only. Handlers: modules/account/handlers/profile.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const { limit } = require('../../middleware/ratelimit');
const h = require('../../../modules/account').handlers.profile;

const r = new Router();
r.patch('/account/profile', requireUser, h.patchAccountProfile);
r.post('/account/password', requireUser, limit('pw-change', 10, 3600), h.postAccountPassword);

module.exports = r;
