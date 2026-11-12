// Auth: sign up: route wiring only. Handlers: modules/auth/handlers/signup.js
const Router = require('../../router');
const { limit } = require('../../middleware/ratelimit');
const settings = require('../../../shared/settings');
const h = require('../../../modules/auth').handlers.signup;

const r = new Router();
r.post('/auth/register', settings.feature('registration'), limit('register', 10, 3600), h.postAuthRegister);

module.exports = r;
