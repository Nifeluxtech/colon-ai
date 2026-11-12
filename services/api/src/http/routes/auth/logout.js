// Auth: sign out: route wiring only. Handlers: modules/auth/handlers/logout.js
const Router = require('../../router');
const h = require('../../../modules/auth').handlers.logout;

const r = new Router();
r.post('/auth/logout', h.postAuthLogout);

module.exports = r;
