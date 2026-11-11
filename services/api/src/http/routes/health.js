const Router = require('../router');
const config = require('../../config');
const db = require('../../db');
const ai = require('../../ai');

const r = new Router();
r.get('/', async () => [200, { name: config.appName, service: 'api', status: 'ok' }]);
r.get('/health', async () => [200, {
  status: 'ok',
  node: process.version,
  env: config.nodeEnv,
  uptime_s: Math.round(process.uptime()),
  database: await db.check(),
  email: Boolean(config.mail.brevoKey),
  two_factor: config.auth.appSecret.length >= 32,
  websocket: '/ws',
  ai: { configured: ai.isConfigured(), providers: Object.keys(ai.enabledProviders()), vision: ai.hasVision() },
}]);

module.exports = r;
