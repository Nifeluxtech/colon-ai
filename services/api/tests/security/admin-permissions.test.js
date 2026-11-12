// Security tests for the Admin Dashboard API: every admin endpoint has the right minimum role and needs 2FA,
// admins cannot act on admin accounts or themselves, and web search keys are stored encrypted and shown masked.
// No database (a fake db module stands in), no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
// Stand-in for src/db so route modules load without MySQL. Any query made by a guard-passing handler is recorded.
const dbPath = require.resolve('../../src/db');
const fakeDb = { calls: [], async query(sql, p) { this.calls.push(sql); return []; }, async one() { return null; } };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
const settings = require('../../src/shared/settings');
const { encrypt, decrypt } = require('../../src/shared/crypto');
/* ---------- Permissions ---------- */
const adminRouter = require('../../src/http/routes/admin');   // every /admin/* route, in order
const routes = adminRouter.routes;
// Minimum role per endpoint (method + path). The release standard: each role sees only what it is allowed to.
function expected(method, p) {
  if (p === '/admin/system' || p === '/admin/providers/:id/key' || p.startsWith('/admin/search')) return 'super_admin';
  if (p.startsWith('/admin/moderation')) return 'moderator';
  if (method === 'GET' && (p === '/admin/users' || p === '/admin/users/:id')) return 'moderator';
  return 'admin';
}
const ROLES = ['user', 'moderator', 'admin', 'super_admin'];
const RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };
const pathOf = (re) => re.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, ':id').replace(/:id\/sessions\/:id/, ':id/sessions/:sid');
test('every admin endpoint is guarded: the right minimum role, 2FA required, members always refused', async () => {
  assert.ok(routes.length >= 40, `found ${routes.length} admin routes`);
  for (const r of routes) {
    const p = pathOf(r.re).replace('/sessions/:id', '/sessions/:sid');
    const need = expected(r.method, p);
    const guard = r.handlers[0];
    for (const role of ROLES) {
      const req = { user: { id: 1, role, totp_enabled: 1 }, params: {}, query: new URLSearchParams(), body: {} };
      const allowed = await guard(req).then(() => true, (e) => { assert.equal(e.status, 403, `${r.method} ${p}`); return false; });
      assert.equal(allowed, RANK[role] >= RANK[need], `${r.method} ${p} as ${role} (needs ${need})`);
    }
    // Staff without 2FA are refused too.
    await assert.rejects(guard({ user: { id: 1, role: 'super_admin', totp_enabled: 0 } }), (e) => e.code === 'needs_2fa', `${r.method} ${p} 2FA`);
    await assert.rejects(guard({ user: null }), (e) => e.status === 401);
  }
});
test('admins cannot act on admin accounts or themselves; only super admins grant admin roles', async () => {
  const admin = adminRouter;
  const find = (m, p) => admin.routes.find(r => r.method === m && pathOf(r.re) === p);
  const suspend = find('POST', '/admin/users/:id/suspend');
  fakeDb.one = async () => ({ id: 9, email: 'boss@example.com', role: 'admin' });
  const req = (role, id = 1) => ({ user: { id, role, totp_enabled: 1 }, params: { id: '9' }, body: { role: 'admin' }, ip: '' });
  await assert.rejects(suspend.handlers[1](req('admin')), (e) => e.status === 403);
  await assert.rejects(suspend.handlers[1](req('super_admin', 9)), (e) => e.code === 'self');
  await suspend.handlers[1](req('super_admin'));   // allowed
  const role = find('PATCH', '/admin/users/:id/role');
  fakeDb.one = async () => ({ id: 9, email: 'x@example.com', role: 'user' });
  await assert.rejects(role.handlers[1](req('admin')), (e) => e.status === 403 && /Super Admin/.test(e.message));
  fakeDb.one = async () => null;
});
test('web search settings (Super Admin): keys stored encrypted and only ever shown masked; bad values refused', async () => {
  const platform = adminRouter;
  const find = (m, p) => platform.routes.find(r => r.method === m && pathOf(r.re) === p);
  const req = (body) => ({ user: { id: 1, role: 'super_admin', totp_enabled: 1 }, params: {}, query: new URLSearchParams(), body, ip: '' });
  fakeDb.calls.length = 0;
  const saved = [];
  const oldQuery = fakeDb.query;
  fakeDb.query = async function (sql, p) { this.calls.push(sql); if (/INSERT INTO app_settings/.test(sql)) saved.push(p); return []; };
  settings.clear();
  await find('POST', '/admin/search/key').handlers[1](req({ provider: 'brave', api_key: 'BSA-secret-key-9876' }));
  const stored = saved.find(p => p[0] === 'search_keys');
  assert.ok(stored && !stored[1].includes('BSA-secret-key-9876'), 'key is encrypted at rest');
  assert.equal(decrypt(JSON.parse(stored[1]).brave.enc), 'BSA-secret-key-9876');
  const audits = fakeDb.calls.filter(sql => /audit/i.test(sql));
  assert.ok(audits.length >= 1);
  await assert.rejects(find('POST', '/admin/search/key').handlers[1](req({ provider: 'google', api_key: 'x'.repeat(20) })), (e) => e.status === 422 || e.code === 'invalid');
  await assert.rejects(find('PATCH', '/admin/search').handlers[1](req({ results: 50 })), (e) => e.status === 422 || e.code === 'invalid');
  await assert.rejects(find('PATCH', '/admin/search').handlers[1](req({ disabled: ['brave', 'tavily', 'searxng', 'duckduckgo', 'wikipedia'] })), (e) => e.status === 422 || e.code === 'invalid');
  const out = require('../../src/modules/admin').handlers.webSearch.searchOut({ enabled: true, order: ['brave', 'duckduckgo'], disabled: [], results: 5, pages: 3, searxngUrl: '',
    providers: [{ id: 'brave', name: 'Brave Search', needs: 'key', ready: true, key: 'BSA-secret-key-9876', keySource: 'database', last4: '9876' }, { id: 'duckduckgo', name: 'DuckDuckGo', ready: true, key: '', keySource: 'none' }] });
  assert.equal(out.providers[0].key.masked, '••••9876');
  assert.ok(!JSON.stringify(out).includes('BSA-secret'));
  fakeDb.query = oldQuery;
  settings.clear();
});
