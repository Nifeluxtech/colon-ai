// Payments: provider webhooks: route wiring only. Handlers: modules/payments/handlers/korapay.js
// No session and no CSRF header (Korapay's servers call it); the handler checks x-korapay-signature.
const Router = require('../router');
const { limit } = require('../middleware/ratelimit');
const h = require('../../modules/payments').handlers.korapay;

const r = new Router();
r.post('/payments/korapay/webhook', { csrf: false }, limit('korapay-webhook', 300, 60), h.postWebhook);

module.exports = r;
