const config = require('../../config');
const db = require('../../db');

const STARTED = new Date().toISOString();

module.exports = {
  'GET /': async () => [200, { name: config.appName, service: 'api', status: 'ok' }],
  'GET /health': async () => [200, {
    status: 'ok',
    node: process.version,
    env: config.nodeEnv,
    started: STARTED,
    uptime_s: Math.round(process.uptime()),
    database: await db.check(),
    websocket: '/ws',
  }],
};
