// Health and root: route wiring only. Handlers: modules/health/handlers/health.js
const Router = require('../router');
const h = require('../../modules/health').handlers.health;

const r = new Router();
r.get('/', h.getRoot);
r.get('/health', h.getHealth);

module.exports = r;
