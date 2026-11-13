// One browser per chat (Phase 10): the control rules (modules/browser/control.js: AI only, AI + me, Manual,
// handoff), the session manager keyed by device AND conversation (REST and the phone's bridge), Saga's commands
// refused while the panel shows another chat, the handoff frame and the runner waiting for Return to AI, and a
// deleted conversation taking its browser sessions and Saga tasks with it. In-memory database, fake phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('../helpers/saga-db').install();
const audit = require('../../src/shared/audit');
const C = require('../../src/modules/browser/control');
const { createBridge } = require('../../src/modules/browser/bridge');
const store = require('../../src/modules/browser/store');
const routes = require('../../src/http/routes');
const saga = require('../../src/modules/saga');

console.log = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let nextUser = 900;

test('control rules: consent, AI only <-> AI + me, take control, handoff, Return to AI', () => {
  const manual = { control: 'manual', paused: 0 };
  let d = C.next('consent', manual, { mode: 'shared' });
  assert.deepEqual(d.next, { control: 'shared', control_owner: 'saga', paused: false });
  assert.equal(d.consented, true);
  d = C.next('mode', { control: 'shared', paused: 0 }, { mode: 'ai', consented: true });
  assert.deepEqual(d.next, { control: 'ai', control_owner: 'saga', paused: false });
  // Changing the mode never hands Saga control: not without consent, not while the user is in control.
  assert.equal(C.next('mode', { control: 'ai' }, { mode: 'shared', consented: false }).next, null);
  assert.equal(C.next('mode', manual, { mode: 'shared', consented: true }).next, null);
  d = C.next('handoff', { control: 'ai', paused: 0 }, { consented: true });
  assert.deepEqual(d.next, { control: 'manual', control_owner: 'user', paused: false });
  assert.equal(d.consented, true, 'consent is kept so Return to AI resumes the task');
  assert.equal(d.cancel, false, 'the phone answered the refused step itself');
  assert.equal(C.next('take_control', { control: 'ai' }, { consented: true }).cancel, true);
  assert.equal(C.next('return_to_ai', manual, { mode: 'ai', consented: true }).next.control, 'ai');
  assert.equal(C.next('return_to_ai', manual, { mode: 'ai', consented: false }).error, 'needs_consent');
  d = C.next('stop', { control: 'ai' }, { consented: true });
  assert.equal(d.consented, false);
  assert.equal(d.next.task, '');
  assert.equal(C.next('nonsense', manual, {}).error, 'bad_control');
});

async function phone(o = {}) {
  const user = { id: o.userId || ++nextUser };
  const frames = [];
  let b = null;
  const send = (m) => {
    frames.push(m);
    setImmediate(() => {
      if (m.type === 'control' && m.mode !== 'manual') b.handle(JSON.stringify({ type: 'control', mode: m.mode,
        reason: 'consent' }));
      if (m.type === 'handoff') {
        b.handle(JSON.stringify({ type: 'control', mode: 'manual', reason: 'handoff' }));
        if (o.returnAfter != null) setTimeout(() => b.handle(JSON.stringify({ type: 'control', mode: 'ai',
          reason: o.returnWith || 'return_to_ai' })), o.returnAfter);
      }
      if (m.type === 'command') b.handle(JSON.stringify({ type: 'ack', ref: m.id, ok: true, result: o.answer
        ? o.answer(m) : {} }));
    });
  };
  b = createBridge({ send, user, req: { ip: '1.1.1.1' }, audit, throttleMs: 0, ackTimeoutMs: 400 });
  await b.handle(JSON.stringify({ type: 'hello', client: 'android', app: 'colonai', device_id: `p${user.id}`,
    app_version: '0.10.0', control: 'manual', conversation_id: o.conv || 'chatA',
    capabilities: ['open_url', 'get_page_content', 'click', 'fill', 'scroll'] }));
  return { b, user, frames };
}

test('the bridge keeps one session per chat; Saga is refused while the panel shows another chat', async () => {
  const p = await phone({ conv: 'chatA' });
  assert.equal(p.b.state.conv, 'chatA');
  await p.b.handle(JSON.stringify({ type: 'session_sync', conversation_id: 'chatA', tabs: [{ tab_id: 't1',
    url: 'https://punchng.com/', title: 'Punch', active: true }] }));
  await p.b.handle(JSON.stringify({ type: 'session_sync', conversation_id: 'chatB', tabs: [{ tab_id: 't9',
    url: 'https://jumia.com.ng/', title: 'Jumia', active: true }] }));
  assert.equal(p.b.state.conv, 'chatB');
  const ref = p.b.state.ref;
  const a = await store.load(p.user.id, { ref, conv: 'chatA' });
  const b = await store.load(p.user.id, { ref, conv: 'chatB' });
  assert.equal(a.tabs[0].url, 'https://punchng.com/');
  assert.equal(b.tabs[0].url, 'https://jumia.com.ng/');
  assert.equal(await store.load(p.user.id, ref), null, 'the device-wide session is separate');
  // Saga asked for chatA while the panel shows chatB: nothing is sent.
  assert.equal(await p.b.askControl('ai', 'x', { conversation: 'chatA' }), false);
  assert.deepEqual(await p.b.command('scroll', { direction: 'down' }, undefined, { conversation: 'chatA' }),
    { ok: false, error: 'other_chat' });
  // Consent in chatB, then the panel switches chat: consent does not follow, pending waits end.
  const answered = p.b.waitControl(500);
  assert.equal(await p.b.askControl('shared', 'look', { conversation: 'chatB' }), true);
  assert.equal(await answered, 'consent');
  assert.equal(p.frames.find((f) => f.type === 'control').conversation_id, 'chatB');
  assert.equal(await p.b.hasControl(), true);
  assert.equal((await store.load(p.user.id, { ref, conv: 'chatB' })).row.control, 'shared');
  const ack = await p.b.command('scroll', { direction: 'down' }, undefined, { conversation: 'chatB' });
  assert.equal(ack.ok, true);
  assert.equal(p.frames.find((f) => f.type === 'command').conversation_id, 'chatB');
  const left = p.b.waitControl(500);
  await p.b.handle(JSON.stringify({ type: 'chat', conversation_id: 'chatA' }));
  assert.equal(await left, 'other_chat');
  assert.equal(await p.b.hasControl(), false);
  // page_state is remembered for "AI + me", only for the chat the panel shows.
  await p.b.handle(JSON.stringify({ type: 'page_state', conversation_id: 'chatA', url: 'https://x.ng/a',
    title: 'A' }));
  await p.b.handle(JSON.stringify({ type: 'page_state', conversation_id: 'chatB', url: 'https://x.ng/b' }));
  assert.equal(p.b.pageState().url, 'https://x.ng/a');
});

test('REST sessions: ?conversation_id= picks the chat\'s own session; bad ids are refused', async () => {
  const user = { id: ++nextUser };
  const call = async (method, query, body) => {
    const m = routes.match(method, '/browser/session');
    const r = { user, ip: '1.1.1.1', query: new URLSearchParams(query), body: body || {}, params: {},
      headers: { 'x-colon-client': 'chat' } };
    try { let out; for (const h of m.handlers) out = await h(r); return out; } catch (e) { return e; }
  };
  const tabs = (u) => ({ tabs: [{ id: 't1', url: u, title: '' }], active_id: 't1' });
  await call('PUT', 'device_id=w1&conversation_id=c1', { session: tabs('https://a.ng/') });
  await call('PUT', 'device_id=w1&conversation_id=c2', { session: tabs('https://b.ng/') });
  await call('PUT', 'device_id=w1', { session: tabs('https://c.ng/') });
  const g = async (q) => (await call('GET', q))[1].session;
  assert.equal((await g('device_id=w1&conversation_id=c1')).tabs[0].url, 'https://a.ng/');
  assert.equal((await g('device_id=w1&conversation_id=c1')).conversation_id, 'c1');
  assert.equal((await g('device_id=w1&conversation_id=c2')).tabs[0].url, 'https://b.ng/');
  assert.equal((await g('device_id=w1')).tabs[0].url, 'https://c.ng/');
  assert.equal((await call('GET', 'device_id=w1&conversation_id=bad id!')).code, 'bad_conversation');
  // Deleting a conversation removes its sessions on every device, never the device-wide one.
  await store.removeConversation(user.id, 'c1');
  assert.equal(await g('device_id=w1&conversation_id=c1'), null);
  assert.ok(await g('device_id=w1&conversation_id=c2'));
  await store.removeAllConversations(user.id);
  assert.equal(await g('device_id=w1&conversation_id=c2'), null);
  assert.ok(await g('device_id=w1'));
});

const PASSWORD_PAGE = { url: 'https://shop.ng/login', title: 'Sign in', text: 'Sign in',
  elements: [{ id: 'c1', tag: 'input', type: 'password', label: 'Password' }] };
function model(replies) {
  let i = 0;
  return async () => ({ text: JSON.stringify(replies[Math.min(i++, replies.length - 1)]) });
}

test('runner: Saga hands the password to the user, the task shows "handoff", Return to AI resumes it', async () => {
  const p = await phone({ conv: 'chatH', returnAfter: 30, answer: (m) => (m.name === 'get_page_content'
    ? PASSWORD_PAGE : {}) });
  const id = await saga.store.create({ userId: p.user.id, goal: 'Sign me in', conversationId: 'chatH',
    mode: 'shared' });
  const task = { id, user_id: p.user.id, goal: 'Sign me in', language: 'en', conversation_id: 'chatH',
    mode: 'shared' };
  await saga.store.claim(id, 'w', p.b.state.ref);
  const seen = [];
  const watch = setInterval(() => seen.push(fake.tables.tasks.find((t) => t.id === id).status), 5);
  const r = await saga.runner.execute(task, p.b, { generate: model([
    { say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Typing your password', action: 'fill', args: { id: 'c1', value: 'x' } },
    { say: 'Done', action: 'finish', args: { answer: 'You are signed in.' } }]), limits: { handoffTimeoutMs: 2000 } });
  clearInterval(watch);
  assert.equal(r.status, 'done');
  assert.ok(seen.includes('handoff'));
  assert.equal(p.frames.find((f) => f.type === 'control').mode, 'shared');
  const h = p.frames.find((f) => f.type === 'handoff');
  assert.equal(h.kind, 'password');
  assert.equal(h.message, 'Enter your password here, then tap Return to AI.');
  assert.equal(h.conversation_id, 'chatH');
  assert.ok(!p.frames.some((f) => f.type === 'command' && f.name === 'fill'));
  const log = fake.tables.actions.filter((a) => a.task_id === id);
  assert.ok(log.some((a) => a.kind === 'handoff' && a.say.startsWith('Enter your password')));
});

test('runner: a handoff nobody answers ends the task (handoff_timeout); the user\'s Stop ends it too', async () => {
  const p = await phone({ conv: 'chatT', answer: (m) => (m.name === 'get_page_content' ? PASSWORD_PAGE : {}) });
  const steps = [{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Typing', action: 'fill', args: { id: 'c1', value: 'x' } }];
  const id = await saga.store.create({ userId: p.user.id, goal: 'g', conversationId: 'chatT' });
  const r = await saga.runner.execute({ id, user_id: p.user.id, goal: 'g', conversation_id: 'chatT' }, p.b,
    { generate: model(steps), limits: { handoffTimeoutMs: 80 } });
  assert.equal(r.status, 'interrupted');
  assert.equal(r.error, 'handoff_timeout');
  const q = await phone({ conv: 'chatS', returnAfter: 20, returnWith: 'stop',
    answer: (m) => (m.name === 'get_page_content' ? PASSWORD_PAGE : {}) });
  const id2 = await saga.store.create({ userId: q.user.id, goal: 'g', conversationId: 'chatS' });
  const r2 = await saga.runner.execute({ id: id2, user_id: q.user.id, goal: 'g', conversation_id: 'chatS' }, q.b,
    { generate: model(steps), limits: { handoffTimeoutMs: 2000 } });
  assert.equal(r2.status, 'interrupted');
  assert.equal(r2.error, 'stop');
  await wait(5);
});

test('POST /browser/agent keeps the chat\'s mode; deleting the chat deletes its Saga tasks', async () => {
  const user = { id: ++nextUser };
  const m = routes.match('POST', '/browser/agent');
  const r = { user, ip: '1.1.1.1', query: new URLSearchParams(), params: {}, headers: {},
    body: { goal: 'Find the fuel price', conversation_id: 'chatM', mode: 'shared' } };
  let out; for (const h of m.handlers) out = await h(r);
  assert.equal(out[0], 202);
  assert.equal(out[1].task.mode, 'shared');
  assert.equal(out[1].task.conversation_id, 'chatM');
  r.body = { goal: 'Again', conversation_id: 'chatM', mode: 'nonsense' };
  for (const h of m.handlers) out = await h(r);
  assert.equal(out[1].task.mode, 'ai');
  assert.equal(fake.tables.tasks.filter((t) => t.conversation_id === 'chatM').length, 2);
  await saga.store.removeConversation(user.id, 'chatM');
  assert.equal(fake.tables.tasks.filter((t) => t.conversation_id === 'chatM').length, 0);
});
