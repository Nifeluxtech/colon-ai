// Unit tests for the Phase 8 session manager on the WebSocket bridge (modules/browser/bridge.js, ws/index.js):
// hello with `app` -> hello with `session: 1`, session_sync limits (64 KB frames, throttle, private tabs, 30 tabs
// or 10 on low-RAM phones, URLs over 2048 dropped), session_request, and the control-owner rules with their audit
// entries. The database is an in-memory fake; one test runs the real gateway on a local port.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fake = require('../helpers/browser-db').install();
const audit = require('../../src/shared/audit');
const { createBridge } = require('../../src/modules/browser/bridge');
const auth = require('../../src/modules/auth');

console.log = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let nextUser = 100;
function phone(o = {}) {
  const frames = [];
  const user = o.user === null ? null : { id: o.userId || ++nextUser };
  const b = createBridge({ send: (m) => frames.push(m), user, req: { ip: '102.89.1.1' }, audit,
    throttleMs: o.throttleMs == null ? 0 : o.throttleMs, ackTimeoutMs: 500 });
  const send = (m) => b.handle(typeof m === 'string' ? m : JSON.stringify(m));
  const last = (type) => [...frames].reverse().find((f) => f.type === type);
  return { b, frames, send, last, user };
}
const hello = (extra = {}) => ({ type: 'hello', v: 1, client: 'android', device_id: 'dev-1', app: 'colonbrowser',
  app_version: '0.8.1', control: 'manual', capabilities: ['open_url'], ...extra });
const tabs = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ tab_id: `t${i}`, url: `https://s${i}.example/`,
  title: `T${i}`, active: i === 0, ...extra }));
const stored = (p) => {
  const s = fake.tables.sessions.find((x) => x.user_id === p.user.id);
  return s && { ...s, tabs: fake.tables.tabs.filter((t) => t.session_id === s.id) };
};

test('signed-out sockets keep the plain hello and get no session features', async () => {
  const p = phone({ user: null });
  await p.send(hello());
  assert.deepEqual(Object.keys(p.last('hello')).sort(), ['service', 'ts', 'type']);
  await p.send({ type: 'session_sync', tabs: tabs(1) });
  assert.equal(p.last('error').code, 'unauthenticated');
  await p.send({ type: 'ping' });
  assert.ok(p.last('pong'));
});

test('hello with app registers the device and answers bridge: 1, session: 1', async () => {
  const p = phone();
  await p.send({ type: 'session_sync', tabs: tabs(1) });
  assert.equal(p.last('error').code, 'no_hello');
  await p.send(hello());
  const h = p.last('hello');
  assert.equal(h.bridge, 1);
  assert.equal(h.session, 1);
  assert.equal(h.service, 'colon-ai');
  // Colon AI on the same phone is its own install (own device_id) and its own device row, linked by the user.
  const ai = phone({ userId: p.user.id });
  await ai.send(hello({ app: 'colonai', device_id: 'dev-2' }));
  const mine = fake.tables.devices.filter((d) => d.user_id === p.user.id).map((d) => d.app).sort();
  assert.deepEqual(mine, ['colonai', 'colonbrowser']);
  await ai.send(hello({ device_id: 'bad id!' }));
  assert.equal(ai.last('error').code, 'bad_device');
});

test('session_sync: 64 KB frames, private tabs, long URLs and the tab limit (10 on low-RAM phones)', async () => {
  const p = phone();
  await p.send(hello());
  const big = JSON.stringify({ type: 'session_sync', tabs: tabs(1), pad: 'x'.repeat(70 * 1024) });
  await p.send(big);
  assert.equal(p.last('error').code, 'frame_too_large');
  assert.equal(stored(p), undefined);
  const list = [{ tab_id: 'secret', url: 'https://bank.example/', title: 'Bank', private: true, active: true },
    { tab_id: 'long', url: 'https://x.example/' + 'a'.repeat(2100), title: 'Long' }, ...tabs(35)];
  await p.send({ type: 'session_sync', tabs: list, active_tab_id: 'secret', control: 'manual', paused: false });
  await p.b.state.writing;
  let s = stored(p);
  assert.equal(s.tabs.length, 30);
  assert.ok(!s.tabs.some((t) => t.tab_id === 'secret' || t.tab_id === 'long'));
  assert.equal(s.active_tab_id, null);
  assert.ok(!JSON.stringify(fake.tables.tabs).includes('bank.example'));
  const low = phone();
  await low.send(hello({ low_ram: true }));
  await low.send({ type: 'session_sync', tabs: tabs(20), active_tab_id: 't3' });
  await low.b.state.writing;
  s = stored(low);
  assert.equal(s.tabs.length, 10);
  assert.equal(s.active_tab_id, 't3');
});

test('session_sync: throttled to one write per window, the latest frame wins', async () => {
  const p = phone({ throttleMs: 150 });
  await p.send(hello());
  const WRITE = /^(UPDATE browser_sessions SET active_tab_id|INSERT INTO browser_sessions)/;
  const writes = () => fake.calls.filter((c) => WRITE.test(c)).length;
  const before = writes();
  await p.send({ type: 'session_sync', tabs: tabs(1) });
  await p.send({ type: 'session_sync', tabs: tabs(2) });
  await p.send({ type: 'session_sync', tabs: tabs(3) });
  assert.equal(writes() - before, 1);
  await wait(250);
  await p.b.state.writing;
  assert.equal(writes() - before, 2);
  assert.equal(stored(p).tabs.length, 3);
});

test('control: one owner; ai only after consent; the user wins at once and pending commands end', async () => {
  const p = phone();
  await p.send(hello());
  // A sync can't hand control to Saga.
  await p.send({ type: 'session_sync', tabs: tabs(1), control: 'ai' });
  await p.b.state.writing;
  assert.equal(stored(p).control, 'manual');
  assert.deepEqual(await p.b.command('open_url', { url: 'https://a.example/' }), { ok: false,
    error: 'manual_control' });
  await p.send({ type: 'control', mode: 'ai', reason: 'return_to_ai' });
  assert.equal(p.last('error').code, 'needs_consent');
  await p.send({ type: 'control', mode: 'ai', paused: false, reason: 'consent' });
  assert.equal(stored(p).control, 'ai');
  assert.equal(stored(p).control_owner, 'saga');
  const pending = p.b.command('open_url', { url: 'https://a.example/' });
  await wait(5);
  const cmd = p.last('command');
  assert.equal(cmd.name, 'open_url');
  await p.send({ type: 'control', mode: 'manual', reason: 'take_control' });
  assert.deepEqual(await pending, { type: 'ack', ref: cmd.id, ok: false, error: 'manual_control' });
  assert.equal(stored(p).control, 'manual');
  assert.equal(stored(p).control_owner, 'user');
  // Having consented once, the user can hand back to Saga; pause stops commands; stop clears consent.
  await p.send({ type: 'control', mode: 'shared', reason: 'return_to_ai' });
  assert.equal(stored(p).control, 'shared');
  const ok = p.b.command('get_tabs');
  await wait(5);
  await p.send({ type: 'ack', ref: p.last('command').id, ok: true, result: { tabs: [] } });
  assert.equal((await ok).ok, true);
  await p.send({ type: 'control', reason: 'pause' });
  assert.deepEqual(await p.b.command('reload'), { ok: false, error: 'paused' });
  await p.send({ type: 'control', reason: 'resume' });
  await p.send({ type: 'control', reason: 'stop' });
  assert.equal(stored(p).control, 'manual');
  await p.send({ type: 'control', mode: 'ai', reason: 'return_to_ai' });
  assert.equal(p.last('error').code, 'needs_consent');
  const reasons = fake.tables.audit.filter((a) => a.action === 'browser.control' && a.target === String(stored(p).id))
    .map((a) => a.meta.reason);
  assert.deepEqual(reasons, ['consent', 'take_control', 'return_to_ai', 'pause', 'resume', 'stop']);
});

test('reconnect: a phone back in manual mode resets a stored AI session', async () => {
  const p = phone();
  await p.send(hello());
  await p.send({ type: 'control', mode: 'ai', reason: 'consent' });
  const again = phone({ userId: p.user.id });
  await again.send(hello({ control: 'manual' }));
  assert.equal(stored(p).control, 'manual');
  assert.equal(fake.tables.audit.filter((a) => a.target === String(stored(p).id)).pop().meta.reason, 'hello');
});

test('session_request: the phone answers by ack; the same rules apply to the answer', async () => {
  const p = phone();
  await p.send(hello());
  const asked = p.b.requestSession();
  await wait(5);
  const req = p.last('session_request');
  assert.ok(req.id);
  await p.send({ type: 'ack', ref: req.id, ok: true, result: { tabs: [{ tab_id: 'inc', url: 'https://x.example/',
    private: true }, ...tabs(2)], active_tab_id: 't1', control: 'ai', paused: false } });
  const r = await asked;
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.tabs.map((t) => t.tab_id), ['t0', 't1']);
  assert.equal(r.result.active_tab_id, 't1');
  assert.equal(r.result.control, 'manual');   // no consent was given
  assert.equal(stored(p).tabs.length, 2);
  const late = p.b.requestSession();
  assert.deepEqual(await late, { ok: false, error: 'timeout', ref: p.last('session_request').id });
});

test('gateway: hello with session: 1 for a signed-in socket, error for oversized frames', async () => {
  const { WebSocket } = require('ws');
  const realLoad = auth.sessions.load;
  auth.sessions.load = async (req) => (req.cookies.colon_sid === 'good' ? { id: 777 } : null);
  const server = http.createServer();
  require('../../src/ws').attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${server.address().port}/ws?client=android&v=1`;
  const open = (headers) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const got = [];
    ws.on('message', (d) => got.push(JSON.parse(d)));
    ws.on('open', () => resolve({ ws, got }));
    ws.on('error', reject);
  });
  try {
    const a = await open({ Cookie: 'colon_sid=good', 'X-Colon-Client': 'android' });
    a.ws.send(JSON.stringify(hello({ device_id: 'gw-1' })));
    a.ws.send('x'.repeat(65 * 1024));
    await wait(80);
    assert.deepEqual(a.got.filter((f) => f.type === 'hello').map((f) => f.session), [undefined, 1]);
    assert.equal(a.got.find((f) => f.type === 'error').code, 'frame_too_large');
    assert.ok(fake.tables.devices.some((d) => d.user_id === 777 && d.device_id === 'gw-1'));
    a.ws.close();
    const b = await open({ 'X-Colon-Client': 'android' });
    b.ws.send(JSON.stringify(hello({ device_id: 'gw-2' })));
    await wait(50);
    assert.equal(b.got.filter((f) => f.type === 'hello').every((f) => !f.session), true);
    b.ws.close();
  } finally {
    auth.sessions.load = realLoad;
    server.close();
  }
});
