// Security tests for 0.17.0 (Blueprint D14-D16): Admin › Tools is admin-only with 2FA and read-only (policies, no
// executors or secrets); the image and deep research routes need a signed-in user; a deep research run is only ever
// visible to, or stoppable by, its owner. A fake db module stands in for MySQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const dbPath = require.resolve('../../src/db');
const fakeDb = { async query() { return []; }, async one() { return null; } };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
const adminRouter = require('../../src/http/routes/admin');
const routes = require('../../src/http/routes');
const research = require('../../src/modules/research');
const h = require('../../src/modules/admin').handlers.tools;

const RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };
const quiet = { info() {}, warn() {}, error() {} };

test('GET /admin/tools: admin or super admin with 2FA only; the only tools route, and read-only', async () => {
  const mine = adminRouter.routes.filter((r) => /admin\\\/tools/.test(r.re.source));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].method, 'GET');
  for (const role of Object.keys(RANK)) {
    const ok = await mine[0].handlers[0]({ user: { id: 1, role, totp_enabled: 1 } }).then(() => true, () => false);
    assert.equal(ok, RANK[role] >= RANK.admin, role);
  }
  await assert.rejects(mine[0].handlers[0]({ user: { id: 1, role: 'super_admin', totp_enabled: 0 } }),
    (e) => e.code === 'needs_2fa');
  const [code, body] = await h.getTools();
  assert.equal(code, 200);
  assert.ok(body.tools.length >= 9);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /apiKey|api_key|secret/i);
  for (const t of body.tools) assert.equal(typeof t.run, 'undefined');
});

test('image and deep research routes need a signed-in user', async () => {
  const paths = [['POST', '/conversations/c1/images'], ['POST', '/conversations/c1/research'],
    ['GET', '/conversations/c1/research'], ['GET', '/research/r1'], ['POST', '/research/r1/cancel']];
  for (const [m, p] of paths) {
    const r = routes.match(m, p);
    assert.ok(r && r.handlers, `${m} ${p}`);
    await assert.rejects(r.handlers[0]({ user: null }), (e) => e.status === 401, `${m} ${p}`);
  }
});

test('deep research runs: another user gets 404 for status and cancel; the owner sees and stops it', async () => {
  const store = research.memoryStore();
  const closed = [];
  research.use({ store, log: quiet, jobs: { enqueue: async () => ({ id: 1, created: true }), liveRefs: async () => [],
    cancelRef: async () => 0 }, tools: { close: async (o) => { closed.push(o); return {}; } } });
  await store.insert({ id: 'run1', user_id: 7, conversation_id: 'c1', message_id: 'm1', question: 'q?',
    request_id: 'research:run1', now: new Date() });
  const req = (uid) => ({ user: { id: uid, role: 'user' }, params: { id: 'run1' } });
  await assert.rejects(research.handlers.getResearchById(req(8)), (e) => e.status === 404);
  await assert.rejects(research.handlers.postResearchByIdCancel(req(8)), (e) => e.status === 404);
  assert.equal((await store.get('run1')).status, 'queued');
  assert.equal(closed.length, 0);
  const [, own] = await research.handlers.getResearchById(req(7));
  assert.equal(own.run.id, 'run1');
  const [, stopped] = await research.handlers.postResearchByIdCancel(req(7));
  assert.equal(stopped.run.status, 'cancelled');
  assert.deepEqual([closed.length, closed[0].ok, closed[0].user.id], [1, false, 7]);   // refunded to its owner
  research.use({});
});
