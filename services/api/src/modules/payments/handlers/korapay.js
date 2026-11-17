// Payments handlers: Korapay checkout, return-page status and webhook (routes: http/routes/payments.js and
// http/routes/account/billing.js). v0.13.0, Blueprint step A5.
const payments = () => require('..');

// POST /account/billing/checkout {plan} -> { reference, checkout_url, plan, amount_minor, currency }
const postCheckout = async (req) => [201, await payments().checkout(req.user, req.body || {})];
// GET /account/billing/payments/:reference -> { reference, plan, status, amount_minor, currency, paid_at }
const getPayment = async (req) => [200, await payments().status(req.user, req.params.reference)];
// POST /payments/korapay/webhook (Korapay's servers; signature-checked, no session, no CSRF header)
const postWebhook = async (req) => payments().webhook(req.body || {}, req.headers || {});

module.exports = { postCheckout, getPayment, postWebhook };
