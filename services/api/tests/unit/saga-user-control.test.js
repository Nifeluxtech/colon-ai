// 0.10.3, the AI-only in-chat browser (docs/decisions/0006-inline-ai-browser.md): Saga hands the browser to the user
// with requestUserControl; Take control and Pause no longer end a task, the loop waits for the browser to come back;
// the user's hand-back message reaches the model with secrets hidden; waiting for the user does not use up the task's
// time; a wait that runs out ends cleanly; the bridge carries the note and the handoff's timeout; the prompt says the
// browser is AI-only.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../helpers/browser-db').install();
const audit = require('../../src/shared/audit');
const { createBridge } = require('../../src/modules/browser/bridge');
const frames = require('../../src/modules/browser/frames');
const { run } = require('../../src/modules/saga/loop');
const tools = require('../../src/modules/saga/tools');
const prompt = require('../../src/modules/saga/prompt');
const runner = require('../../src/modules/saga/runner');

console.log = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMITS = { maxSteps: 10, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const PAGE = { ok: true, result: { url: 'https://dash.example.com/login', title: 'Log in', text: 'Log in',
  elements: [{ id: 'c1', tag: 'button', text: 'Continue with GitHub' }] } };

function model(replies) {
  const seen = [];
  return { seen, decide: async (messages) => { seen.push(messages);
    return JSON.stringify(replies[Math.min(seen.length - 1, replies.length - 1)]); } };
}
function phone(map = {}) {
  const calls = [];
  return { calls, command: async (name, args) => { calls.push({ name, args });
    const a = map[name]; return typeof a === 'function' ? a(args) : a || { ok: true, result: {} }; } };
}
const go = (o) => {
  const rows = [];
  return run({ goal: 'Deploy the app on the dashboard', limits: LIMITS, isStopped: async () => false,
    log: async (e) => { rows.push(e); }, ...o }).then((r) => ({ ...r, rows }));
};
const all = (seen) => seen.map((ms) => ms.map((m) => m.content).join('\n')).join('\n');

test('requestUserControl hands the browser to the user; Saga continues with their message', async () => {
  const m = model([
    { say: 'Reading the page', action: 'getPageContent', args: {} },
    { say: 'You need to sign in', action: 'request_user_control', args: { reason: 'sign_in',
      instructions: 'Sign in to the dashboard, then tell me.' } },
    { say: 'Reading again', action: 'getPageContent', args: {} },
    { say: 'Deployed', action: 'finish', args: { answer: 'Deployed v0.10.2 [1].', result: 'Deployed Colon AI v0.10.2',
      sources: [1] } },
  ]);
  const p = phone({ get_page_content: PAGE });
  const asked = [];
  const r = await go({ decide: m.decide, command: p.command, handoff: async (info, o) => { asked.push([info, o]);
    return 'return_to_ai'; }, takeNote: () => 'I have logged in, continue' });
  assert.equal(r.status, 'done');
  assert.equal(r.result, 'Deployed Colon AI v0.10.2');
  assert.deepEqual(asked[0][0], { kind: 'sign_in', message: 'Sign in to the dashboard, then tell me.',
    reason: 'Saga asked: sign_in' });
  assert.equal(asked[0][1].phoneStarted, false);
  assert.match(all(m.seen), /did what you asked in the browser and gave control back/);
  assert.match(all(m.seen), /their words, not page content\): "I have logged in, continue"/);
  const h = r.rows.find((x) => x.kind === 'handoff');
  assert.equal(h.name, 'request_user_control');
  assert.equal(h.say, 'Sign in to the dashboard, then tell me.');
  assert.equal(r.rows.find((x) => x.kind === 'finish').say, 'Deployed Colon AI v0.10.2');
  // Nothing was sent to the phone for the request itself.
  assert.deepEqual(p.calls.map((c) => c.name), ['get_page_content', 'get_page_content']);
});

test('requestUserControl without instructions gets a plain default; an unknown reason is "other"', () => {
  assert.deepEqual(tools.userRequest({ reason: 'captcha' }), { kind: 'captcha', reason: 'Saga asked: captcha',
    message: 'Solve the check on the page, then tell me in the chat.' });
  assert.equal(tools.userRequest({ reason: 'hack', instructions: 'Do it\nnow' }).kind, 'other');
  assert.equal(tools.userRequest({ instructions: 'x'.repeat(400) }).message.length, 200);
  assert.equal(tools.canonical('request_user_control'), 'requestUserControl');
  assert.throws(() => tools.toCommand('requestUserControl', {}), /Unknown tool/);
});

test('Take control no longer ends the task: Saga waits, is told, and carries on', async () => {
  let n = 0;
  const m = model([
    { say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Clicking Continue', action: 'click', args: { id: 'c1' } },
    { say: 'Reading again', action: 'getPageContent', args: {} },
    { say: 'Done', action: 'finish', args: { answer: 'Done.' } },
  ]);
  const p = phone({ get_page_content: PAGE, click: () => (++n === 1 ? { ok: false, error: 'manual_control' }
    : { ok: true, result: {} }) });
  const waits = [];
  const r = await go({ decide: m.decide, command: p.command, waitUser: async (why) => { waits.push(why);
    return 'return_to_ai'; }, takeNote: () => 'I clicked it myself. The code was 123456' });
  assert.equal(r.status, 'done');
  assert.deepEqual(waits, ['manual_control']);
  assert.match(all(m.seen), /The user took control of the browser \(your last step did not run\)/);
  assert.match(all(m.seen), /I clicked it myself/);
});

test('Pause waits for Resume; a wait that runs out or a Stop ends the task', async () => {
  const replies = [{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Done', action: 'finish', args: { answer: 'ok' } }];
  let first = true;
  const paused = phone({ get_page_content: () => (first ? (first = false, { ok: false, error: 'paused' }) : PAGE) });
  const r = await go({ decide: model(replies).decide, command: paused.command, waitUser: async () => 'resume' });
  assert.equal(r.status, 'done');
  const held = phone({ get_page_content: { ok: false, error: 'manual_control' } });
  const t = await go({ decide: model(replies).decide, command: held.command, waitUser: async () => 'timeout' });
  assert.equal(t.status, 'interrupted');
  assert.equal(t.error, 'user_timeout');
  const s = await go({ decide: model(replies).decide, command: held.command, waitUser: async () => 'stop' });
  assert.equal(s.error, 'stop');
  // An older runner without waitUser: Take control still ends the task as before.
  const old = await go({ decide: model(replies).decide, command: held.command });
  assert.equal(old.status, 'interrupted');
  assert.equal(old.error, 'manual_control');
});

test('time spent waiting for the user does not count against the task limit', async () => {
  let clock = 0;
  const m = model([
    { say: 'Need the code', action: 'requestUserControl', args: { reason: 'one_time_code' } },
    { say: 'Done', action: 'finish', args: { answer: 'ok' } },
  ]);
  const r = await go({ decide: m.decide, command: phone().command, now: () => clock,
    limits: { ...LIMITS, taskTimeoutMs: 1000 },
    handoff: async () => { clock += 60000; return 'return_to_ai'; } });
  assert.equal(r.status, 'done');
});

test('frames.note: one line, secrets and long numbers hidden, ordinary numbers kept', () => {
  assert.equal(frames.note('  I logged in.\nThe code was 552019  '), 'I logged in. The code was [hidden]');
  assert.equal(frames.note('password: hunter2 then pin 4321'), 'password: [hidden] then pin [hidden]');
  assert.equal(frames.note('Card 4111 1111 1111 1111 works, order 12345'), 'Card [number hidden] works, order 12345');
  assert.equal(frames.note(null), '');
  assert.equal(frames.note('y'.repeat(900)).length, frames.MAX_NOTE);
  assert.deepEqual(frames.notice('Saga stopped', 'stopped'), { type: 'notice', text: 'Saga stopped', kind: 'stopped' });
});

let nextUser = 7300;
test('bridge: Return to AI carries the user\'s note once; handoff tells the phone how long Saga waits', async () => {
  const sent = [];
  const b = createBridge({ send: (m) => sent.push(m), user: { id: ++nextUser }, req: { ip: '102.89.1.1' }, audit,
    throttleMs: 0, ackTimeoutMs: 300 });
  const send = (m) => b.handle(JSON.stringify(m));
  await send({ type: 'hello', v: 1, client: 'android', device_id: 'dev-user-control', app: 'colonai',
    app_version: '0.10.3', control: 'manual', capabilities: ['get_page_content'], conversation_id: '9' });
  await send({ type: 'control', mode: 'ai', paused: false, reason: 'consent' });
  assert.equal(b.handoff({ kind: 'sign_in', message: 'Sign in here', timeoutMs: 600000 }, { conversation: '9' }), true);
  const h = [...sent].reverse().find((f) => f.type === 'handoff');
  assert.equal(h.timeout_ms, 600000);
  assert.equal(h.kind, 'sign_in');
  await send({ type: 'control', mode: 'manual', paused: false, reason: 'handoff' });
  const back = b.waitControl(500);
  await send({ type: 'control', mode: 'ai', paused: false, reason: 'return_to_ai',
    note: 'Logged in.\nMy password is hunter2' });
  assert.equal(await back, 'return_to_ai');
  assert.equal(b.takeNote(), 'Logged in. My password is [hidden]');
  assert.equal(b.takeNote(), '');
  b.close();
  await wait(1);
});

test('runner: how a task ends on the phone\'s status pill', () => {
  assert.deepEqual([runner.endKind({ status: 'done' }), runner.endLine({ status: 'done', result: 'Booked it' })],
    ['done', 'Booked it']);
  assert.equal(runner.endLine({ status: 'done' }), 'Done. Saga’s answer is in the chat.');
  assert.equal(runner.endKind({ status: 'interrupted', error: 'handoff_timeout' }), 'stopped');
  assert.match(runner.endLine({ status: 'interrupted', error: 'user_timeout' }), /given back in time/);
  assert.equal(runner.endKind({ status: 'failed', error: 'phone_timeout' }), 'error');
  assert.equal(runner.settings().userControlTimeoutMs, 900000);
});

test('the prompt tells the model the browser is AI-only and how to ask for the user', () => {
  const s = prompt.system({ maxSteps: 15, mode: 'ai' });
  assert.match(s, /The browser is AI-only/);
  assert.match(s, /requestUserControl \{"reason"/);
  assert.match(s, /call requestUserControl with one short, clear instruction/);
  assert.match(s, /"result": "a few words for the status line/);
});
