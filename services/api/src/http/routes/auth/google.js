// Auth: Google sign-in: route wiring only. Handlers: modules/auth/handlers/google.js
const Router = require('../../router');
const { limit } = require('../../middleware/ratelimit');
const h = require('../../../modules/auth').handlers.google;

const r = new Router();
r.post('/auth/google', limit('google', 30, 900), h.postAuthGoogle);

module.exports = r;
