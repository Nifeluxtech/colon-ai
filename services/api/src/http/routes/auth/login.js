// Auth: email and password sign-in: route wiring only. Handlers: modules/auth/handlers/login.js
const Router = require('../../router');
const { limit } = require('../../middleware/ratelimit');
const h = require('../../../modules/auth').handlers.login;

const r = new Router();
r.post('/auth/login', limit('login', 30, 900), h.postAuthLogin);

module.exports = r;
