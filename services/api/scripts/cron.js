// The cron dispatcher (0.16.0, Blueprint C11): one pass over the job table, run by cPanel cron every
// JOBS_CRON_INTERVAL_MIN minutes. It talks to MySQL directly (no HTTP: AfeesHost's ALTCHA can block non-browser
// clients on the API subdomain), enqueues this period's recurring jobs, claims small batches with a lease, runs them,
// records the run in colon_cron_runs and exits within JOBS_TIME_LIMIT_MS. Two overlapping runs are safe: a job is
// only ever leased to one of them.
//
//   cd /home/apparatu/repositories/colon-ai/services/api && \
//     /home/apparatu/nodevenv/repositories/colon-ai/services/api/24/bin/node \
//     --env-file=/home/apparatu/.colon-cron.env scripts/cron.js
//
// cron does not see the Setup Node.js App variables, so they come from a private env file (chmod 600, outside every
// web root) with at least NODE_ENV, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME and the BILLING_ / JOBS_ keys you set.
// Options: --env <file> (load an env file, same as node's --env-file), --quiet (print only on errors).
// Exit code: 0 ok, 1 configuration or run error, 2 the hard time limit was hit.
const args = process.argv.slice(2);
const envAt = args.indexOf('--env');
if (envAt > -1 && args[envAt + 1]) process.loadEnvFile(args[envAt + 1]);
const quiet = args.includes('--quiet');

const config = require('../src/config');
try { config.assertValid(); } catch (e) { console.error(e.message); process.exit(1); }

const limitMs = config.jobs.timeLimitMs;
const hard = setTimeout(() => {
  console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'cron_time_limit', ms: limitMs }));
  process.exit(2);
}, limitMs + 10000);
hard.unref();

const jobs = require('../src/modules/jobs');
const db = require('../src/db');

async function main() {
  const run = await jobs.tick({ runner: 'cli' });
  const line = { t: new Date().toISOString(), level: run.error ? 'error' : 'info', msg: 'cron_run',
    ms: run.duration_ms, claimed: run.claimed, done: run.done, failed: run.failed, dead: run.dead,
    ...(run.error ? { err: run.error } : {}) };
  if (run.error) console.error(JSON.stringify(line));
  else if (!quiet) console.log(JSON.stringify(line));
  const pool = db.getPool();
  if (pool) await pool.end().catch(() => {});
  return run.error ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'cron_failed', err: e.message }));
  process.exit(1);
});
