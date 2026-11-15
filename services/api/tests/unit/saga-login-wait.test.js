// 0.11.6 (owner's report on Android 0.11.5): Saga asked for a login on reviewer.yolotask.com.ng, signIn answered
// no_login, the phone showed Colon Secured Login, the user SAVED it, and Saga stayed stuck (10-minute silent wait);
// "Login n" and "Hi" typed meanwhile got no reply. End to end on the bridge (runner + loop + saved-login +
// login-wait), the guide endpoint while Saga waits, and the chat model's browser state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('../helpers/saga-db').install();
const audit = require('../../src/shared/audit');
const { createBridge } = require('../../src/modules/browser/bridge');
const saga = require('../../src/modules/saga');
const browserState = require('../../src/modules/chat/browser-state');
const { run } = require('../../src/modules/saga/loop');

console.log = () => {};
const CAPS = ['open_url', 'get_page_content', 'click', 'fill', 'get_page_state', 'sign_in'];
const SITE = 'reviewer.yolotask.com.ng';
const LOGIN = { url: `https://${SITE}/login`, title: 'Reviewer sign in', text: 'Sign in',
  elements: [{ id: 'c1', tag: 'input', type: 'email', label: 'Email', form: true, form_secret: 'password' },
    { id: 'c2', tag: 'input', type: 'password', label: 'Password', form: true, secret: 'password' }] };
const DASH = { url: `https://${SITE}/dashboard`, title: 'Reviewer dashboard', text: 'Welcome back, Yolotask. Sign out',
  elements: [{ id: 'c9', tag: 'a', text: 'Sign out', href: `https://${SITE}/logout` }] };
let nextUser = 9600;

// A phone like the 0.11.6 app: consent, acks; sign_in answers no_login until the login is saved; o.onHandoff plays
// the user's part on the Colon Secured Login form.
async function phone(o = {}) {
  const user = { id: ++nextUser };
  const frames = [];
  const st = { saved: false, signIns: 0 };
  let b = null;
  const say = (m) => b.handle(JSON.stringify(m));
  const send = (m) => {
    frames.push(m);
    setImmediate(() => {
      if (m.type === 'control' && m.mode !== 'manual') say({ type: 'control', mode: 'ai', paused: false,
        reason: 'consent' });
      if (m.type === 'control' && m.mode === 'manual') say({ type: 'control', mode: 'manual', reason: 'stop' });
      if (m.type === 'handoff' && o.onHandoff) o.onHandoff(m, say, st);
      if (m.type !== 'command') return;
      let a = { ok: true, result: st.signedIn ? DASH : LOGIN };
      if (m.name === 'sign_in') {
        st.signIns++;
        a = st.saved ? { ok: true, result: { submitted: true } } : { ok: false, error: 'no_login' };
        if (st.saved) st.signedIn = true;
      }
      say({ type: 'ack', ref: m.id, ...a });
    });
  };
  b = createBridge({ send, user, req: { ip: '102.89.1.1' }, audit, throttleMs: 0, ackTimeoutMs: 400 });
  await say({ type: 'hello', v: 1, client: 'android', app: 'colonai', device_id: `lw${user.id}`, app_version: '0.11.6',
    control: 'manual', capabilities: CAPS, conversation_id: '88' });
  return { b, user, frames, st, req: { user, ip: '102.89.1.1', params: {}, query: new URLSearchParams(), body: {} } };
}
function model(replies, seen) {
  let i = 0;
  return async (o) => { if (seen) seen.push(o.messages.map((m) => m.content).join('\n'));
    return { text: JSON.stringify(replies[Math.min(i++, replies.length - 1)]) }; };
}
const REPLIES = [
  { say: 'Reading the sign-in page', action: 'getPageContent', args: {} },
  { say: 'Signing in', action: 'signIn', args: { site: SITE } },
  { say: 'Signed in', action: 'finish', args: { answer: 'You are signed in to the reviewer page.', result:
    'Signed in to reviewer.yolotask.com.ng' } },
];
const taskRow = (id) => fake.tables.tasks.find((t) => t.id === id);
const LIMITS = { handoffTimeoutMs: 4000 };

test('the login form saved (control login_saved): the wait ends at once and Saga signs in with it', async () => {
  const seen = [];
  const p = await phone({ onHandoff: (m, say, st) => setTimeout(async () => {
    assert.equal(m.kind, 'login');
    assert.equal(taskRow(p.task).status, 'handoff');
    await say({ type: 'control', mode: 'manual', reason: 'handoff' });
    st.saved = true;
    await say({ type: 'control', mode: 'ai', reason: 'login_saved', site: SITE });
  }, 20) });
  const t0 = Date.now();
  const r = await saga.runner.start(p.req, { goal: 'Log in to yolotask', language: 'en', conversationId: '88' },
    { generate: model(REPLIES, seen), limits: LIMITS });
  p.task = r.id;
  await r.done;
  assert.equal(taskRow(r.id).status, 'done');
  assert.ok(Date.now() - t0 < 3000, 'no long wait');
  assert.equal(p.st.signIns, 2);                       // no_login, then at once with the saved login
  assert.deepEqual(p.frames.filter((f) => f.type === 'handoff').map((f) => f.kind), ['login']);
  assert.match(seen.at(-1), /Colon signed in on reviewer\.yolotask\.com\.ng with the login the user saved/);
});

test('safety net: a "Login saved for …" note on another control frame still ends the wait (control asked back)',
  async () => {
    const p = await phone({ onHandoff: (m, say, st) => setTimeout(async () => {
      await say({ type: 'control', mode: 'manual', reason: 'handoff' });
      st.saved = true;
      // An older phone path: the note rides on a frame that is not a Give back (here a repeated take_control).
      await say({ type: 'control', mode: 'manual', reason: 'take_control',
        note: `Login saved for ${SITE} in Colon Secured Login` });
    }, 20) });
    const r = await saga.runner.start(p.req, { goal: 'Log in to yolotask', language: 'en', conversationId: '88' },
      { generate: model(REPLIES), limits: LIMITS });
    p.task = r.id;
    await r.done;
    assert.equal(taskRow(r.id).status, 'done');
    assert.equal(p.st.signIns, 2);
    // Saga had lost control (the user held the browser): it asked again the usual way, then signed in.
    assert.ok(p.frames.filter((f) => f.type === 'control' && f.mode === 'ai').length >= 2);
  });

test('closing the form without saving resumes at once: the sign-in is handed to the user (no silent wait)',
  async () => {
    const p = await phone({ onHandoff: (m, say, st) => setTimeout(async () => {
      await say({ type: 'control', mode: 'manual', reason: 'handoff' });
      if (m.kind === 'login') {
        await say({ type: 'control', mode: 'ai', reason: 'return_to_ai', note: 'I didn\'t save a login.' });
        return;
      }
      st.signedIn = true;                              // the user signed in themselves
      await say({ type: 'control', mode: 'ai', reason: 'return_to_ai', note: 'Signed in, continue' });
    }, 20) });
    const t0 = Date.now();
    const r = await saga.runner.start(p.req, { goal: 'Log in to yolotask', language: 'en', conversationId: '88' },
      { generate: model(REPLIES), limits: LIMITS });
    await r.done;
    assert.ok(Date.now() - t0 < 3000);
    assert.deepEqual(p.frames.filter((f) => f.type === 'handoff').map((f) => f.kind), ['login', 'sign_in']);
    assert.match(p.frames.filter((f) => f.type === 'handoff')[1].message, /Sign in to reviewer\.yolotask\.com\.ng/);
    assert.equal(p.st.signIns, 1);
  });

test('a bare Give back (no note) tries the saved login once; the loop never waits on the form again', async () => {
  const calls = [];
  const handoffs = [];
  const r = await run({ goal: 'Log in', limits: { maxSteps: 8, taskTimeoutMs: 5000, modelTimeoutMs: 1000,
    stepTimeoutMs: 500, approvalTimeoutMs: 800 }, isStopped: async () => false, caps: CAPS, autoRead: true,
  decide: ((i) => async () => JSON.stringify(REPLIES[Math.min(i++, 2)]))(1), log: async () => {},
  command: async (name, args) => { calls.push(name);
    if (name === 'sign_in') return calls.filter((c) => c === 'sign_in').length === 1 ? { ok: false, error: 'no_login' }
      : { ok: true, result: {} };
    return { ok: true, result: name === 'get_page_content' ? DASH : {} }; },
  handoff: async (info) => { handoffs.push(info.kind); return 'return_to_ai'; }, takeNote: () => '' });
  assert.equal(r.status, 'done');
  assert.deepEqual(handoffs, ['login']);
  assert.equal(calls.filter((c) => c === 'sign_in').length, 2);
});

test('a message typed while Saga waits is not queued for "its next step": guide answers 409 waiting', async () => {
  const p = await phone();
  const id = await saga.store.create({ userId: p.user.id, goal: 'Log in to yolotask', conversationId: '88' });
  const req = (body) => ({ ...p.req, params: { id: String(id) }, body });
  await saga.store.setStatus(id, 'handoff');
  await assert.rejects(saga.handlers.tasks.guideTask(req({ text: 'Hi' })), (e) => e.status === 409
    && e.code === 'waiting');
  // While Saga is really working, the message is kept for its next step as before.
  await saga.store.setStatus(id, 'running');
  const [code] = await saga.handlers.tasks.guideTask(req({ text: 'use the cheaper one' }));
  assert.equal(code, 202);
});

test('the chat model sees that Saga waits for a login on <site>, so "Hi" gets a reply that can explain it',
  async () => {
    const steps = [{ kind: 'action', tool: 'signIn', command: 'sign_in', args: { site: SITE }, ok: false,
      error: 'no_login', say: 'Signing in' }, { kind: 'handoff', say: `Save your ${SITE} login in Colon Secured `
      + 'Login (it stays on this phone) and Saga signs in for you.', error: 'login', tool: 'signIn' }];
    const store = { list: async () => [{ id: 5, goal: 'Log in to yolotask', status: 'handoff',
      created_at: new Date() }], actions: async () => steps };
    const s = await browserState.load({ userId: 1, conversationId: '88', store });
    assert.deepEqual(s.task.waiting, { kind: 'login', site: SITE, say: steps[1].say });
    const block = browserState.block(s);
    assert.match(block, /Saga is WAITING for a login on reviewer\.yolotask\.com\.ng/);
    assert.match(block, /"continue"/);
    // A running task says nothing of the kind; a paused one says so.
    const running = await browserState.load({ userId: 1, conversationId: '88', store: { ...store,
      list: async () => [{ id: 5, goal: 'x', status: 'running', created_at: new Date() }] } });
    assert.equal(running.task.waiting, null);
    assert.doesNotMatch(browserState.block(running), /WAITING/);
    assert.equal(browserState.waitingFor({ status: 'paused' }, []).kind, 'paused');
  });
