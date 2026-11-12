// Account: delete account: route wiring only. Handlers: modules/account/handlers/delete.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const { limit } = require('../../middleware/ratelimit');
const h = require('../../../modules/account').handlers.remove;

const r = new Router();
r.post('/account/delete', requireUser, limit('delete', 5, 3600), h.postAccountDelete);

module.exports = r;
