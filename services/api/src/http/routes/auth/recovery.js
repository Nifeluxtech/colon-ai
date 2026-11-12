// Auth: email verification and password reset: route wiring only. Handlers: modules/auth/handlers/recovery.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const { limit } = require('../../middleware/ratelimit');
const h = require('../../../modules/auth').handlers.recovery;

const r = new Router();
r.post('/auth/verify-email', limit('verify', 30, 3600), h.postAuthVerifyEmail);
r.post('/auth/resend-verification', requireUser, limit('resend', 5, 3600), h.postAuthResendVerification);
r.post('/auth/forgot', limit('forgot', 5, 3600), h.postAuthForgot);
r.post('/auth/reset', limit('reset', 10, 3600), h.postAuthReset);

module.exports = r;
