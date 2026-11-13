// Unit tests for the Phase 8 browser REST routes (http/routes/browser.js, modules/browser handlers): the reader's
// switch, guest gate and rate limits (429 with retry_after), and the session manager: optimistic `version` with
// 409 conflict, private tabs / long URLs / tab limit, one session per device, the sessions list, and history.
// The database is an in-memory fake (tests/helpers/browser-db.js); no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('../helpers/browser-db').install();
const routes = require('../../src/http/routes');

console.log = () => {};
const req = (o = {}) => ({ user: o.user === undefined ? { id: 1 } : o.user, ip: o.ip || '102.89.1.1',
  query: new URLSearchParams(o.query || ''), body: o.body || {}, params: o.params || {},
  headers: { 'x-colon-client': 'browser', ...(o.headers || {}) } });

// Runs a route's handler chain like http/server.js does; returns [status, body, headers] or the thrown error.
async function call(method, path, o, { stopBefore } = {}) {
  const m = routes.match(method, path);
  assert.ok(m && !m.methodNotAllowed, `${method} ${path} is routed`);
  const r = req(o);
  Object.assign(r.params, m.params);
  let out;
  const handlers = stopBefore ? m.handlers.slice(0, stopBefore) : m.handlers;
  try { for (const h of handlers) out = await h(r); } catch (e) { return { error: e }; }
  return { status: out && out[0], body: out && out[1], headers: out && out[2] };
}
const tab = (id, url, extra = {}) => ({ id, url, title: `Tab ${id}`, back: [], fwd: [], ...extra });

test.beforeEach(() => { fake.tables.rates.clear(); delete process.env.BROWSER_READER;
  delete process.env.BROWSER_READER_GUESTS; });

test('reader route: switch off -> 501 not_enabled; guests off -> 401', async () => {
  process.env.BROWSER_READER = 'off';
  let r = await call('GET', '/browser/fetch', { query: 'url=https://punchng.com/' });
  assert.equal(r.error.status, 501);
  assert.equal(r.error.code, 'not_enabled');
  delete process.env.BROWSER_READER;
  process.env.BROWSER_READER_GUESTS = 'off';
  r = await call('GET', '/browser/fetch', { user: null, query: 'url=https://punchng.com/' });
  assert.equal(r.error.status, 401);
  r = await call('GET', '/browser/fetch', { query: 'url=' }, {});
  assert.equal(r.error.code, 'bad_url');
});

test('reader route: 30 a minute per user, 500 a day, 60 a minute per guest IP, with retry_after', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await call('GET', '/browser/fetch', {}, { stopBefore: 2 })).error,
    undefined);
  let r = await call('GET', '/browser/fetch', {}, { stopBefore: 2 });
  assert.equal(r.error.status, 429);
  assert.equal(r.error.code, 'rate_limited');
  assert.deepEqual(r.error.extra, { retry_after: 60 });
  assert.equal(r.error.headers['Retry-After'], '60');
  fake.tables.rates.set('reader-day:u2', 500);
  r = await call('GET', '/browser/fetch', { user: { id: 2 } }, { stopBefore: 2 });
  assert.equal(r.error.extra.retry_after, 86400);
  for (let i = 0; i < 60; i++) assert.equal((await call('GET', '/browser/fetch', { user: null }, { stopBefore: 2 }))
    .error, undefined);
  r = await call('GET', '/browser/fetch', { user: null }, { stopBefore: 2 });
  assert.equal(r.error.code, 'rate_limited');
  // Another IP has its own budget.
  assert.equal((await call('GET', '/browser/fetch', { user: null, ip: '102.89.9.9' }, { stopBefore: 2 })).error,
    undefined);
});

test('session: needs sign-in; PUT creates version 1, GET returns it, a stale version gets 409 conflict', async () => {
  assert.equal((await call('GET', '/browser/session', { user: null })).error.code, 'unauthenticated');
  assert.deepEqual((await call('GET', '/browser/session', { query: 'device_id=dev-a' })).body, { session: null });
  const s1 = { tabs: [tab('t1', 'https://punchng.com/'), tab('t2', 'colon://newtab', { back:
    ['https://a.example/', 42] })], active_id: 't2', control: 'manual' };
  let r = await call('PUT', '/browser/session', { query: 'device_id=dev-a', body: { session: s1, version: 0 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.version, 1);
  assert.equal(r.body.session.active_id, 't2');
  assert.deepEqual(r.body.session.tabs[1].back, ['https://a.example/']);
  r = await call('GET', '/browser/session', { query: 'device_id=dev-a' });
  assert.equal(r.body.session.tabs.length, 2);
  assert.equal(r.body.session.control_owner, 'user');
  // Version 1 is current: this write wins and makes version 2.
  r = await call('PUT', '/browser/session', { query: 'device_id=dev-a', body: { session: { ...s1, active_id: 't1' },
    version: 1 } });
  assert.equal(r.body.session.version, 2);
  // Another tab of the same device still holds version 1: conflict, with the current session to merge.
  r = await call('PUT', '/browser/session', { query: 'device_id=dev-a', body: { session: { ...s1, tabs: [] },
    version: 1 } });
  assert.equal(r.error.status, 409);
  assert.equal(r.error.code, 'conflict');
  assert.equal(r.error.extra.session.version, 2);
  assert.equal(r.error.extra.session.tabs.length, 2);
  // The version inside the session works too (RemoteBrowserData sends the session it loaded).
  r = await call('PUT', '/browser/session', { query: 'device_id=dev-a', body: { session: { ...s1, version: 2 } } });
  assert.equal(r.body.session.version, 3);
  // A writer that thinks a session exists when it was deleted is told so.
  r = await call('PUT', '/browser/session', { query: 'device_id=dev-new', body: { session: s1, version: 4 } });
  assert.equal(r.error.code, 'conflict');
  assert.equal(r.error.extra.session, null);
  assert.equal((await call('PUT', '/browser/session', { body: { session: [] } })).error.code, 'bad_session');
  assert.equal((await call('PUT', '/browser/session', { body: { session: s1, version: -1 } })).error.code,
    'bad_version');
  assert.equal((await call('GET', '/browser/session', { query: 'device_id=../../x' })).error.code, 'bad_device');
});

test('session: private tabs, long URLs and tabs past 30 are never stored', async () => {
  const tabs = [tab('p1', 'https://secret.example/', { private: true }), tab('long', 'https://x.example/'
    + 'a'.repeat(2100)), tab('js', 'javascript:alert(1)'), tab('bad id with spaces', 'https://x.example/')];
  for (let i = 0; i < 40; i++) tabs.push(tab(`t${i}`, `https://site${i}.example/`));
  const r = await call('PUT', '/browser/session', { query: 'device_id=dev-limits', body: { session: { tabs,
    active_id: 'p1' } } });
  const ids = r.body.session.tabs.map((t) => t.id);
  assert.equal(ids.length, 30);
  assert.ok(!ids.includes('p1') && !ids.includes('long') && !ids.includes('js'));
  assert.equal(r.body.session.active_id, null);          // the active tab was private: no active tab is reported
  assert.ok(!JSON.stringify(fake.tables.tabs).includes('secret.example'));
});

test('session: one per device and app; list for "continue on this device"; DELETE clears it', async () => {
  await call('PUT', '/browser/session', { user: { id: 5 }, query: 'device_id=phone-web', body: { session: {
    tabs: [tab('a', 'https://a.example/'), tab('b', 'https://b.example/')], active_id: 'b' } } });
  await call('PUT', '/browser/session', { user: { id: 5 }, query: 'device_id=laptop', headers: { 'x-colon-client':
    'web' }, body: { session: { tabs: [tab('c', 'https://c.example/')] } } });
  // Older web builds send no device_id: they share one "web" device per app.
  await call('PUT', '/browser/session', { user: { id: 5 }, body: { session: { tabs: [] } } });
  const list = (await call('GET', '/browser/sessions', { user: { id: 5 } })).body.sessions;
  assert.equal(list.length, 3);
  const phone = list.find((s) => s.device.device_id === 'phone-web');
  assert.deepEqual(phone.active, { url: 'https://b.example/', title: 'Tab b' });
  assert.equal(phone.tabs, 2);
  assert.equal(phone.device.app, 'web-browser');
  assert.equal(list.find((s) => s.device.device_id === 'laptop').device.app, 'web-chat');
  // Another user sees none of them.
  assert.equal((await call('GET', '/browser/sessions', { user: { id: 6 } })).body.sessions.length, 0);
  assert.deepEqual((await call('DELETE', '/browser/session', { user: { id: 5 }, query: 'device_id=phone-web' }))
    .body, { ok: true });
  assert.deepEqual((await call('GET', '/browser/session', { user: { id: 5 }, query: 'device_id=phone-web' })).body,
    { session: null });
  assert.equal((await call('GET', '/browser/sessions', { user: { id: 5 } })).body.sessions.length, 2);
});

test('history: add, search, remove one, clear; private and non-web URLs are refused', async () => {
  const u = { id: 9 };
  let r = await call('POST', '/browser/history', { user: u, body: { url: 'https://punchng.com/fuel', title:
    'Fuel prices' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.entry.url, 'https://punchng.com/fuel');
  await call('POST', '/browser/history', { user: u, body: { url: 'https://bbc.com/pidgin', title: 'BBC Pidgin' } });
  assert.deepEqual((await call('POST', '/browser/history', { user: u, body: { url: 'https://s.example/',
    private: true } })).body, { entry: null });
  assert.equal((await call('POST', '/browser/history', { user: u, body: { url: 'colon://newtab' } })).error.code,
    'bad_url');
  r = await call('GET', '/browser/history', { user: u, query: 'q=fuel&limit=10' });
  assert.deepEqual(r.body.history.map((h) => h.title), ['Fuel prices']);
  r = await call('GET', '/browser/history', { user: u });
  assert.equal(r.body.history.length, 2);
  await call('DELETE', `/browser/history/${r.body.history[0].id}`, { user: u });
  assert.equal((await call('GET', '/browser/history', { user: u })).body.history.length, 1);
  assert.deepEqual((await call('DELETE', '/browser/history', { user: u })).body, { ok: true });
  assert.equal((await call('GET', '/browser/history', { user: u })).body.history.length, 0);
  assert.equal((await call('DELETE', '/browser/history/abc', { user: u })).error.status, 404);
});
