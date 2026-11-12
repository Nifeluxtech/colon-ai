const Router = require('../router');
const config = require('../../config');
const db = require('../../db');
const ai = require('../../modules/ai');
const dynamic = require('../../modules/ai').dynamic;

const r = new Router();
r.get('/', async () => [200, { name: config.appName, service: 'api', status: 'ok' }]);
r.get('/health', async () => { const cfg = await dynamic.load(); return [200, {
  status: 'ok',
  node: process.version,
  env: config.nodeEnv,
  uptime_s: Math.round(process.uptime()),
  database: await db.check(),
  email: Boolean(config.mail.brevoKey),
  two_factor: config.auth.appSecret.length >= 32,
  websocket: '/ws',
  ai: { configured: ai.isConfigured(cfg), providers: Object.keys(ai.enabledProviders(cfg)), vision: ai.hasVision(cfg), routing: cfg.source },
}]; });

module.exports = r;
