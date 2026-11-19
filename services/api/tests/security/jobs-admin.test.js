// Security tests for Admin › Jobs and the cron trigger (0.16.0): only admins (with 2FA) see or change jobs, every
// retry / cancel needs a reason and is audited with the acting admin, and POST /internal/cron/run is off without
// CRON_SECRET and refuses a wrong secret. A fake db module stands in for MySQL; jobs use the in-memory store.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const dbPath = require.resolve('../../src/db');
const fakeDb = { calls: [], async query(sql, p) { this.calls.push({ sql, p }); return []; },
  async one() { return null; } };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
const config = require('../../src/config');
const jobs = require('../../src/modules/jobs');
const adminRouter = require('../../src/http/routes/admin');
const routes = require('../../src/http/routes');
const h = require('../../src/modules/admin').handlers.jobs;

const RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };
const store = jobs.memoryStore();
jobs.use({ store });
jobs.registry.register('test.sec', { run() {} });

test('every /admin/jobs route needs admin or super admin with 2FA', async () => {
  const mine = adminRouter.routes.filter((r) => /admin\\\/jobs/.test(r.re.source));
  assert.equal(mine.length, 3);
  for (const r of mine) {
    for (const role of Object.keys(RANK)) {
      const ok = await r.handlers[0]({ user: { id: 1, role, totp_enabled: 1 } }).then(() => true, () => false);
      assert.equal(ok, RANK[role] >= RANK.admin, `${r.method} ${r.re.source} as ${role}`);
    }
    await assert.rejects(r.handlers[0]({ user: { id: 1, role: 'super_admin', totp_enabled: 0 } }),
      (e) => e.code === 'needs_2fa');
  }
});

test('retry and cancel need a reason and are written to the audit log with the admin and the reason', async () => {
  const { id } = await jobs.enqueue('test.sec', {});
  const req = (body) => ({ user: { id: 42, role: 'admin' }, params: { id: String(id) }, body, ip: '10.0.0.1',
    query: new URLSearchParams() });
  await assert.rejects(h.postCancel(req({})), (e) => e.status === 422 && e.field === 'reason');
  assert.equal(store.tables.jobs[0].status, 'queued');
  fakeDb.calls.length = 0;
  const [code, body] = await h.postCancel(req({ reason: 'duplicate run' }));
  assert.deepEqual([code, body.job.status], [200, 'cancelled']);
  const audit = fakeDb.calls.find((c) => /INSERT INTO audit_log/.test(c.sql));
  assert.ok(audit, 'audited');
  assert.deepEqual([audit.p[0], audit.p[1], audit.p[2], audit.p[3]], [42, 'admin.job_cancelled', 'job', String(id)]);
  assert.equal(JSON.parse(audit.p[5]).reason, 'duplicate run');
  const [, r] = await h.postRetry(req({ reason: 'fixed upstream' }));
  assert.equal(r.job.status, 'queued');
  assert.ok(fakeDb.calls.some((c) => /INSERT INTO audit_log/.test(c.sql) && c.p[1] === 'admin.job_retried'));
  const [, v] = await h.getJobs({ query: new URLSearchParams('status=queued') });
  assert.equal(v.jobs.length, 1);
  assert.ok(v.cron && 'warn' in v.cron);
});

test('the cron trigger: 404 without CRON_SECRET, 403 on a wrong secret, a recorded run on the right one', async () => {
  const route = routes.match('POST', '/internal/cron/run');
  assert.ok(route && route.opts.csrf === false);
  const trigger = jobs.handlers.postCronRun;
  const old = config.jobs.cronSecret;
  try {
    config.jobs.cronSecret = '';
    await assert.rejects(trigger({ headers: { 'x-cron-secret': 'anything' } }), (e) => e.status === 404);
    config.jobs.cronSecret = 's3cret-value-for-tests';
    await assert.rejects(trigger({ headers: {} }), (e) => e.status === 403);
    await assert.rejects(trigger({ headers: { 'x-cron-secret': 's3cret-value-for-test' } }), (e) => e.status === 403);
    const before = store.tables.runs.length;
    const [code, body] = await trigger({ headers: { 'x-cron-secret': 's3cret-value-for-tests' } });
    assert.deepEqual([code, body.ok, body.run.runner], [200, true, 'http']);
    assert.equal(store.tables.runs.length, before + 1);
  } finally { config.jobs.cronSecret = old; }
});
