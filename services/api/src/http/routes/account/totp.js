// Account: two-factor authentication (TOTP): route wiring only. Handlers: modules/account/handlers/totp.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const { limit } = require('../../middleware/ratelimit');
const h = require('../../../modules/account').handlers.totp;

const r = new Router();
r.post('/account/2fa/setup', requireUser, h.postAccount2faSetup);
r.post('/account/2fa/enable', requireUser, limit('2fa', 20, 900), h.postAccount2faEnable);
r.post('/account/2fa/disable', requireUser, limit('2fa', 20, 900), h.postAccount2faDisable);

module.exports = r;
