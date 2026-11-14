// 0.10.3 end to end on the bridge (ADR 0006): Saga asks for the user with requestUserControl and carries on when
// the phone gives the browser back with the user's note; the user's own Take control mid-task waits instead of
// ending the task; the phone's Stop ends it; the result line reaches the phone's status pill and the chat's card
// list (GET /browser/agent?conversation_id=).
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
let nextUser = 8100;
const PAGE = { ok: true, result: { url: 'https://dash.example.com/', title: 'Dashboard', text: 'Deploy',
  elements: [{ id: 'c1', tag: 'button', text: 'Deploy' }] } };

// A phone that answers like the 0.10.3 app: consent, acks, and o.onHandoff / o.onCommand for the user's part.
async function phone(o = {}) {
  const user = { id: ++nextUser };
  const frames = [];
  let b = null;
  const say = (m) => b.handle(JSON.stringify(m));
  const send = (m) => {
    frames.push(m);
    setImmediate(() => {
      if (m.type === 'control' && m.mode !== 'manual') say({ type: 'control', mode: 'ai', paused: false,
        reason: 'consent' });
      if (m.type === 'control' && m.mode === 'manual') say({ type: 'control', mode: 'manual', reason: 'stop' });
      if (m.type === 'handoff' && o.onHandoff) o.onHandoff(m, say);
      if (m.type === 'command') Promise.resolve((o.onCommand || (() => PAGE))(m, say))
        .then((a) => a && say({ type: 'ack', ref: m.id, ...a }));
    });
  };
  b = createBridge({ send, user, req: { ip: '102.89.1.1' }, audit, throttleMs: 0, ackTimeoutMs: 400 });
  await say({ type: 'hello', v: 1, client: 'android', app: 'colonai', device_id: `uc${user.id}`, app_version: '0.10.3',
    control: 'manual', capabilities: CAPS, conversation_id: '77' });
  return { b, user, frames, req: { user, ip: '102.89.1.1', params: {}, query: new URLSearchParams(), body: {} } };
}
function model(replies, seen) {
  let i = 0;
  return async (o) => { if (seen) seen.push(o.messages.map((m) => m.content).join('\n'));
    return { text: JSON.stringify(replies[Math.min(i++, replies.length - 1)]) }; };
}
const taskRow = (id) => fake.tables.tasks.find((t) => t.id === id);

test('requestUserControl: needs_user on the phone, the user gives it back with a note, Saga finishes', async () => {
  const seen = [];
  const p = await phone({ onHandoff: (m, say) => setTimeout(async () => {
    assert.equal(taskRow(p.task).status, 'handoff');
    await say({ type: 'control', mode: 'manual', reason: 'handoff' });
    await say({ type: 'control', mode: 'ai', reason: 'return_to_ai', note: 'Logged in, continue (page now: dash)' });
  }, 20) });
  const r = await saga.runner.start(p.req, { goal: 'Deploy my app', language: 'en', conversationId: '77' },
    { generate: model([
      { say: 'Reading', action: 'getPageContent', args: {} },
      { say: 'Need you to sign in', action: 'requestUserControl', args: { reason: 'sign_in',
        instructions: 'Sign in with GitHub, then tell me.' } },
      { say: 'Deploying', action: 'finish', args: { answer: 'Deployed.', result: 'Deployed Colon AI v0.10.2' } },
    ], seen) });
  p.task = r.id;
  await r.done;
  assert.equal(taskRow(r.id).status, 'done');
  const h = p.frames.find((f) => f.type === 'handoff');
  assert.deepEqual([h.kind, h.message, h.timeout_ms], ['sign_in', 'Sign in with GitHub, then tell me.', 600000]);
  assert.match(seen.at(-1), /"Logged in, continue \(page now: dash\)"/);
  const notice = p.frames.filter((f) => f.type === 'notice').at(-1);
  assert.deepEqual([notice.kind, notice.text, notice.conversation_id], ['done', 'Deployed Colon AI v0.10.2', '77']);
  // The chat's cards on the web: this conversation's tasks with their result line.
  const [code, body] = await saga.handlers.tasks.listTasks({ ...p.req,
    query: new URLSearchParams('conversation_id=77') });
  assert.equal(code, 200);
  assert.deepEqual(body.tasks.map((t) => [t.id, t.conversation_id, t.result]), [[r.id, '77',
    'Deployed Colon AI v0.10.2']]);
  const [, other] = await saga.handlers.tasks.listTasks({ ...p.req, query: new URLSearchParams('conversation_id=9') });
  assert.equal(other.tasks.length, 0);
});

test('Take control mid-task: the task waits (user_control), then carries on after Give back', async () => {
  let clicks = 0;
  const p = await phone({ onCommand: (m, say) => {
    if (m.name !== 'click') return PAGE;
    if (++clicks > 1) return { ok: true, result: { changed: 'navigated', url: 'https://dash.example.com/done' } };
    // The user takes the browser while the click is pending: the server cancels it (manual_control).
    setTimeout(async () => {
      await say({ type: 'control', mode: 'manual', reason: 'take_control' });
      await wait(30);
      assert.equal(taskRow(p.task).status, 'user_control');
      await say({ type: 'control', mode: 'ai', reason: 'return_to_ai', note: 'I picked the region myself' });
    }, 10);
    return null;
  } });
  const seen = [];
  const r = await saga.runner.start(p.req, { goal: 'Deploy', language: 'en', conversationId: '77' },
    { generate: model([
      { say: 'Reading', action: 'getPageContent', args: {} },
      { say: 'Clicking Deploy', action: 'click', args: { id: 'c1' } },
      { say: 'Reading again', action: 'getPageContent', args: {} },
      { say: 'Clicking Deploy', action: 'click', args: { id: 'c1' } },
      { say: 'Done', action: 'finish', args: { answer: 'ok', result: 'Deployed' } },
    ], seen) });
  p.task = r.id;
  await r.done;
  assert.equal(taskRow(r.id).status, 'done');
  assert.ok(seen.some((s) => /The user took control of the browser/.test(s) && /I picked the region myself/.test(s)));
});

test('the phone\'s Stop while Saga waits for the user ends the task at once', async () => {
  const p = await phone({ onCommand: (m, say) => {
    if (m.name !== 'click') return PAGE;
    setTimeout(() => say({ type: 'control', mode: 'manual', reason: 'stop' }), 10);
    return null;
  } });
  const t0 = Date.now();
  const r = await saga.runner.start(p.req, { goal: 'Deploy', language: 'en', conversationId: '77' },
    { generate: model([{ say: 'Reading', action: 'getPageContent', args: {} },
      { say: 'Clicking', action: 'click', args: { id: 'c1' } }]) });
  await r.done;
  assert.equal(taskRow(r.id).status, 'interrupted');
  assert.equal(taskRow(r.id).error, 'stop');
  assert.ok(Date.now() - t0 < 3000, 'no wait for a browser that will never come back');
});
