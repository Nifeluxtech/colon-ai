// Account: plan and credits: route wiring only. Handlers: modules/account/handlers/billing.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const h = require('../../../modules/account').handlers.billing;

const r = new Router();
r.get('/account/billing', requireUser, h.getAccountBilling);

module.exports = r;
