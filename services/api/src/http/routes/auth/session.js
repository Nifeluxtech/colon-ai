// Auth: public config and current user: route wiring only. Handlers: modules/auth/handlers/session.js
const Router = require('../../router');
const h = require('../../../modules/auth').handlers.session;

const r = new Router();
r.get('/auth/config', h.getAuthConfig);
r.get('/auth/me', h.getAuthMe);

module.exports = r;
