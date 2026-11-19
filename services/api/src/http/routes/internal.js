// Internal triggers (v0.16.0): route wiring only. Handler: modules/jobs/index.js (handlers.postCronRun).
// POST /internal/cron/run runs one dispatcher pass. Secondary to the cron CLI (services/api/scripts/cron.js): no
// session and no CSRF header (a server calls it); the X-Cron-Secret header must match CRON_SECRET, and while
// CRON_SECRET is empty the route answers 404.
const Router = require('../router');
const { limit } = require('../middleware/ratelimit');
const h = require('../../modules/jobs').handlers;

const r = new Router();
r.post('/internal/cron/run', { csrf: false }, limit('cron-trigger', 30, 600), h.postCronRun);

module.exports = r;
