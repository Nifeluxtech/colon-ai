// Account: plan and credits: route wiring only. Handlers: modules/account/handlers/billing.js,
// modules/payments/handlers/korapay.js (checkout and the return page, v0.13.0)
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const { perUser } = require('../../middleware/ratelimit');
const h = require('../../../modules/account').handlers.billing;
const pay = require('../../../modules/payments').handlers.korapay;

const r = new Router();
r.get('/account/billing', requireUser, h.getAccountBilling);
r.post('/account/billing/checkout', requireUser, perUser('billing-checkout', 10, 3600), pay.postCheckout);
r.get('/account/billing/payments/:reference', requireUser, pay.getPayment);

module.exports = r;
