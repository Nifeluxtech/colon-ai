// 0.10.4 (ADR 0006 addendum): a Saga task outlives its phone's socket. A wait for the user (handoff, Take control)
// goes on when the same phone reconnects (the handoff is sent again, the user's Give back on the new socket counts);
// a read in flight is sent again, an action in flight is reported to the model as "may or may not have happened";
// no reconnect within SAGA_RECONNECT_GRACE_MS ends the task as interrupted and tells nobody twice; a task another
// worker took over ends here quietly; and the sweep adopts a task whose worker went quiet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('../helpers/saga-db').install();
const audit = require('../../src/shared/audit');
const { createBridge } = require('../../src/modules/browser/bridge');
const saga = require('../../src/modules/saga');

console.log = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CAPS = ['open_url', 'get_page_content', 'get_links', 'click', 'fill', 'scroll', 'screenshot', 'back',
  'forward', 'reload', 'get_tabs'];
const PAGE = { ok: true, result: { url: 'https://yolotask.com.ng/', title: 'Yolotask', text: 'Login',
  elements: [{ id: 'c1', tag: 'button', text: 'Login' }] } };
// A plain button (no approval needed) for the click tests.
const MORE = { ok: true, result: { url: 'https://yolotask.com.ng/tasks', title: 'Tasks', text: 'Tasks',
  elements: [{ id: 'c1', tag: 'button', text: 'Show more' }] } };
const LIMITS = { reconnectGraceMs: 1500 };
let nextUser = 9100;
const taskRow = (id) => fake.tables.tasks.find((t) => t.id === id);

// One socket of a phone (same device on every socket of the same user): consent, acks, o.onHandoff / o.onCommand.
async function socket(user, o = {}) {
  const s = { frames: [], b: null };
  const say = (m) => s.b.handle(JSON.stringify(m));
  s.say = say;
  const send = (m) => {
    s.frames.push(m);
    setImmediate(() => {
      if (m.type === 'control' && m.mode !== 'manual') say({ type: 'control', mode: 'ai', paused: false,
        reason: 'consent' });
      if (m.type === 'handoff' && o.onHandoff) o.onHandoff(m, say, s);
      if (m.type === 'command') Promise.resolve((o.onCommand || (() => PAGE))(m, say, s))
        .then((a) => a && !s.b.state.closed && say({ type: 'ack', ref: m.id, ...a }));
    });
  };
  s.b = createBridge({ send, user, req: { ip: '102.89.1.1' }, audit, throttleMs: 0, ackTimeoutMs: 600 });
  await say({ type: 'hello', v: 1, client: 'android', app: 'colonai', device_id: `rc${user.id}`, app_version: '0.10.4',
    control: o.control || 'manual', resumable: o.resumable, capabilities: CAPS, conversation_id: '55' });
  return s;
}
function newUser() {
  const user = { id: ++nextUser };
  return { user, req: { user, ip: '102.89.1.1', params: {}, query: new URLSearchParams(), body: {} } };
}
function model(replies, seen) {
  let i = 0;
  return async (o) => { if (seen) seen.push(o.messages.map((m) => m.content).join('\n'));
    return { text: JSON.stringify(replies[Math.min(i++, replies.length - 1)]) }; };
}
const LOGIN = [
  { say: 'Reading', action: 'getPageContent', args: {} },
  { say: 'Need you to log in', action: 'requestUserControl', args: { reason: 'sign_in',
    instructions: 'Please enter your username and password, then tap Give back.' } },
  { say: 'Checking', action: 'getPageContent', args: {} },
  { say: 'Done', action: 'finish', args: { answer: 'You are logged in.', result: 'Logged in to Yolotask' } },
];

test('a wait for the user survives the socket dropping: the same phone reconnects and gives the browser back',
  async () => {
    const u = newUser();
    const seen = [];
    let second = null;
    await socket(u.user, { onHandoff: (m, say, s) => setTimeout(async () => {
      await say({ type: 'control', mode: 'manual', reason: 'handoff' });
      // The user switches to a password manager: mobile data drops the socket.
      s.b.close();
      await wait(200);
      assert.equal(taskRow(u.task).status, 'handoff', 'still waiting, not interrupted');
      second = await socket(u.user, { resumable: 'ai', onHandoff: () => {} });
      await wait(50);
      await second.say({ type: 'control', mode: 'ai', reason: 'return_to_ai', note: 'I\'ve logged in, continue' });
    }, 20) });
    const r = await saga.runner.start(u.req, { goal: 'Login', language: 'en', conversationId: '55' },
      { limits: LIMITS, generate: model(LOGIN, seen) });
    u.task = r.id;
    await r.done;
    assert.equal(taskRow(r.id).status, 'done');
    assert.ok(second.frames.some((f) => f.type === 'handoff'), 'the request is shown again on the new socket');
    assert.ok(!second.frames.some((f) => f.type === 'error'), 'hello resumable: the Give back needs no new consent');
    assert.match(seen.at(-1), /I've logged in, continue/);
    const notice = second.frames.filter((f) => f.type === 'notice').at(-1);
    assert.deepEqual([notice.kind, notice.text], ['done', 'Logged in to Yolotask']);
  });

test('no reconnect within the grace: interrupted (disconnected), the row let go', async () => {
  const u = newUser();
  await socket(u.user, { onHandoff: (m, say, s) => setTimeout(() => s.b.close(), 10) });
  const t0 = Date.now();
  const r = await saga.runner.start(u.req, { goal: 'Login', language: 'en', conversationId: '55' },
    { limits: { reconnectGraceMs: 300 }, generate: model(LOGIN) });
  await r.done;
  assert.equal(taskRow(r.id).status, 'interrupted');
  assert.equal(taskRow(r.id).error, 'disconnected');
  assert.ok(Date.now() - t0 < 4000);
});

test('a read in flight is sent again after the reconnect; an action in flight is checked, not repeated', async () => {
  const u = newUser();
  const seen = [];
  let reads = 0, clicks = 0;
  const reconnect = async (s) => { s.b.close(); await wait(100); await socket(u.user, { control: 'ai',
    onCommand: (m) => { if (m.name === 'click') clicks++; else reads++; return MORE; } }); };
  await socket(u.user, { onCommand: (m, say, s) => {
    if (m.name === 'get_page_content' && reads++ === 0) { reconnect(s); return null; }
    if (m.name === 'click') { clicks++; return null; }
    return MORE;
  } });
  const replies = [{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Clicking Show more', action: 'click', args: { id: 'c1' } },
    { say: 'Checking', action: 'getPageContent', args: {} },
    { say: 'Done', action: 'finish', args: { answer: 'ok', result: 'Opened login' } }];
  const r = await saga.runner.start(u.req, { goal: 'Open login', language: 'en', conversationId: '55' },
    { limits: LIMITS, generate: model(replies, seen) });
  await r.done;
  assert.equal(taskRow(r.id).status, 'done');
  assert.equal(reads >= 2, true, 'the read was sent again on the new socket');
  assert.equal(clicks, 1, 'the click is never repeated by the server');
});

test('a dropped action answers "reconnected": the model is told to look before acting again', async () => {
  const u = newUser();
  const seen = [];
  await socket(u.user, { onCommand: (m, say, s) => {
    if (m.name !== 'click') return MORE;
    setTimeout(async () => { s.b.close(); await wait(50); await socket(u.user, { control: 'ai',
      onCommand: () => MORE }); }, 10);
    return null;
  } });
  const r = await saga.runner.start(u.req, { goal: 'Open login', language: 'en', conversationId: '55' },
    { limits: LIMITS, generate: model([{ say: 'Reading', action: 'getPageContent', args: {} },
      { say: 'Clicking Show more', action: 'click', args: { id: 'c1' } },
      { say: 'Done', action: 'finish', args: { answer: 'ok' } }], seen) });
  await r.done;
  assert.equal(taskRow(r.id).status, 'done');
  assert.ok(seen.some((x) => /may or may not have happened/.test(x)));
});

test('another worker adopted the task meanwhile: this run ends quietly and writes nothing more', async () => {
  const u = newUser();
  await socket(u.user, { onHandoff: (m, say, s) => setTimeout(async () => {
    s.b.close();
    await wait(80);
    taskRow(u.task).worker = 'other-host:42';       // the phone came back on another worker, which took it
  }, 10) });
  const r = await saga.runner.start(u.req, { goal: 'Login', language: 'en', conversationId: '55' },
    { limits: LIMITS, generate: model(LOGIN) });
  u.task = r.id;
  const out = await r.done;
  assert.equal(out.status, 'moved');
  assert.equal(taskRow(r.id).status, 'handoff', 'left to the worker that holds it now');
});

test('the sweep adopts a waiting task whose worker went quiet, waits on, and runs on with its history', async () => {
  const u = newUser();
  const seen = [];
  const old = new Date(Date.now() - 60000);
  const id = await saga.store.create({ userId: u.user.id, goal: 'Login', conversationId: '55' });
  Object.assign(taskRow(id), { status: 'handoff', worker: 'recycled:7', updated_at: old });
  await saga.store.addAction(id, u.user.id, 1, { kind: 'control', error: 'consent' });
  await saga.store.addAction(id, u.user.id, 2, { kind: 'action', say: 'Reading the page', tool: 'getPageContent',
    name: 'get_page_content', ok: true, url: 'https://yolotask.com.ng/' });
  await saga.store.addAction(id, u.user.id, 3, { kind: 'handoff', say: 'Please log in', error: 'sign_in' });
  const s = await socket(u.user, { resumable: 'ai' });
  await saga.runner.sweep({ limits: LIMITS, generate: model([{ say: 'Checking', action: 'getPageContent', args: {} },
    { say: 'Done', action: 'finish', args: { answer: 'Logged in.', result: 'Logged in' } }], seen) });
  await wait(50);
  assert.equal(taskRow(id).worker, saga.runner.WORKER);
  await s.say({ type: 'control', mode: 'ai', reason: 'return_to_ai', note: 'done, continue' });
  for (let i = 0; i < 40 && taskRow(id).status !== 'done'; i++) await wait(50);
  assert.equal(taskRow(id).status, 'done');
  assert.match(seen[0], /Reading the page on yolotask\.com\.ng/);
  assert.match(seen[0], /done, continue/);
  const seqs = fake.tables.actions.filter((a) => a.task_id === id).map((a) => a.seq);
  assert.equal(new Set(seqs).size, seqs.length, 'the log goes on after the last step');
});

test('orphans nobody adopted within the grace end as interrupted', async () => {
  const u = newUser();
  const id = await saga.store.create({ userId: u.user.id, goal: 'Login', conversationId: '55' });
  Object.assign(taskRow(id), { status: 'user_control', worker: null, updated_at: new Date(Date.now() - 600000) });
  const s = await socket(u.user);
  await saga.runner.sweep({ limits: LIMITS });
  assert.equal(taskRow(id).status, 'interrupted');
  assert.equal(taskRow(id).error, 'disconnected');
  s.b.close();
});

test('continue_of: a Continue starts from the earlier task\'s summary and stops it when it is still live',
  async () => {
    const u = newUser();
    const prev = await saga.store.create({ userId: u.user.id, goal: 'Login to yolotask', conversationId: '55' });
    Object.assign(taskRow(prev), { status: 'handoff', worker: 'gone:1' });
    await saga.store.addAction(prev, u.user.id, 1, { kind: 'action', say: 'Opening the login page', tool: 'openUrl',
      name: 'open_url', ok: true, url: 'https://earner.yolotask.com.ng/login.php' });
    await saga.store.addAction(prev, u.user.id, 2, { kind: 'handoff', say: 'Please log in', error: 'sign_in' });
    const seen = [];
    await socket(u.user);
    const h = saga.handlers.tasks;
    const realStart = saga.runner.start;
    let done = null;
    saga.runner.start = async (req, o) => { const r = await realStart(req, o, { limits: LIMITS, generate: model([
      { say: 'Done', action: 'finish', args: { answer: 'Logged in.' } }], seen) }); done = r.done; return r; };
    try {
      const [code, body] = await h.postTask({ ...u.req, body: { continue_of: prev } });
      assert.equal(code, 202);
      assert.equal(body.task.goal, 'Login to yolotask');
      assert.equal(body.task.conversation_id, '55');
      await done;
      assert.equal(taskRow(prev).stop_requested, 1);
      const first = fake.tables.actions.find((a) => a.task_id === body.task.id && a.seq === 1);
      assert.equal(first.kind, 'continue');
      assert.match(seen[0], /Opening the login page on earner\.yolotask\.com\.ng/);
      assert.match(seen[0], /Asked the user: Please log in/);
      await assert.rejects(h.postTask({ ...u.req, body: { continue_of: 999999 } }), { status: 404 });
    } finally { saga.runner.start = realStart; }
  });

test('resume.summary: the steps, where they were, how the attempt ended; capped', () => {
  const { summary, historyOf, prompt } = require('../../src/modules/saga/resume');
  const acts = [{ kind: 'control', error: 'consent' },
    { kind: 'action', say: 'Opening the login page', url: 'https://www.earner.yolotask.com.ng/login.php', ok: true },
    { kind: 'action', say: 'Clicking Sign in', ok: false, error: 'no_element' },
    { kind: 'handoff', say: 'Please log in' }];
  const s = summary({ status: 'interrupted', error: 'disconnected' }, acts);
  assert.equal(s, '1. Opening the login page on earner.yolotask.com.ng\n2. Clicking Sign in (failed: no_element)\n'
    + '3. Asked the user: Please log in\nThe earlier attempt was interrupted (disconnected).');
  const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'action', say: `Step ${i}`, ok: true }));
  assert.match(summary(null, many), /^\(18 earlier steps not shown\)\n1\. Step 18/);
  assert.equal(historyOf([]), '');
  assert.match(historyOf([{ kind: 'continue', args: { summary: 'X' } }]), /^Earlier attempt at this task:\nX$/);
  assert.equal(prompt(''), '');
  assert.match(prompt('X'), /Call getPageContent first/);
});
