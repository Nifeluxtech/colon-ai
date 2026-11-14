// 0.10.2, the server's half of the owner's report: Saga's own words reach the phone so "AI + me" can show what it
// is doing ("Clicking Sign in") and asking ("Need your OTP") on the page. The loop hands each step's `say` to the
// command, the bridge puts it on the command frame (one clean line), notices go only to the chat the panel shows,
// and the model hears plainly when typing or scrolling did not happen (the phone's act.js checks).
const test = require('node:test');
const assert = require('node:assert/strict');
require('../helpers/browser-db').install();
const audit = require('../../src/shared/audit');
const { createBridge } = require('../../src/modules/browser/bridge');
const frames = require('../../src/modules/browser/frames');
const { run } = require('../../src/modules/saga/loop');
const prompt = require('../../src/modules/saga/prompt');
const safety = require('../../src/modules/safety');

console.log = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let nextUser = 900;
function phone() {
  const sent = [];
  const b = createBridge({ send: (m) => sent.push(m), user: { id: ++nextUser }, req: { ip: '102.89.1.1' }, audit,
    throttleMs: 0, ackTimeoutMs: 300 });
  const send = (m) => b.handle(JSON.stringify(m));
  const last = (type) => [...sent].reverse().find((f) => f.type === type);
  return { b, sent, send, last };
}
const hello = (extra = {}) => ({ type: 'hello', v: 1, client: 'android', device_id: 'dev-notice', app: 'colonai',
  app_version: '0.10.2', control: 'manual', capabilities: ['get_page_content', 'click'], ...extra });

test('frames: one clean line, at most 160 characters; empty lines send nothing', () => {
  assert.equal(frames.line('  Clicking\n"Sign in"\u0007 now '), 'Clicking "Sign in" now');
  assert.equal(frames.line('x'.repeat(400)).length, 160);
  assert.deepEqual(frames.say(''), {});
  assert.deepEqual(frames.say('Reading the page'), { say: 'Reading the page' });
  assert.equal(frames.notice('   ', 'done'), null);
  assert.deepEqual(frames.notice('Done', 'weird'), { type: 'notice', text: 'Done', kind: 'step' });
  assert.deepEqual(frames.notice('Need your OTP', 'ask', '42'), { type: 'notice', text: 'Need your OTP', kind: 'ask',
    conversation_id: '42' });
});

test('the command frame carries Saga\'s say; notices go to the chat the panel shows only', async () => {
  const p = phone();
  await p.send(hello({ conversation_id: '42' }));
  await p.send({ type: 'control', mode: 'shared', paused: false, reason: 'consent' });
  const pending = p.b.command('click', { id: 'c3' }, undefined, { conversation: '42', say: 'Clicking\n"Sign in"' });
  await wait(5);
  const cmd = p.last('command');
  assert.equal(cmd.say, 'Clicking "Sign in"');
  assert.equal(cmd.conversation_id, '42');
  assert.deepEqual(cmd.args, { id: 'c3' });                     // never part of what the step does
  await p.send({ type: 'ack', ref: cmd.id, ok: true, result: { changed: 'navigated' } });
  assert.equal((await pending).ok, true);
  p.b.command('get_page_content', {}, undefined, { conversation: '42' });
  await wait(5);
  assert.equal('say' in p.last('command'), false);              // nothing to say: no field
  assert.equal(p.b.notice('Done. Saga’s answer is in the chat.', 'done', { conversation: '42' }), true);
  assert.deepEqual({ ...p.last('notice'), ts: 0 }, { type: 'notice', text: 'Done. Saga’s answer is in the chat.',
    kind: 'done', conversation_id: '42', ts: 0 });
  const before = p.sent.length;
  assert.equal(p.b.notice('Done', 'done', { conversation: '77' }), false);   // another chat
  assert.equal(p.b.notice('', 'done', { conversation: '42' }), false);
  assert.equal(p.sent.length, before);
  const anon = createBridge({ send: () => { throw new Error('sent'); }, user: null });
  assert.equal(anon.notice('Done', 'done'), false);
});

test('the loop passes each step\'s say with its command', async () => {
  const replies = [
    { say: 'Reading the page', action: 'getPageContent', args: {} },
    { say: 'Clicking Sign in', action: 'click', args: { id: 'c1' } },
    { say: 'Done', action: 'finish', args: { answer: 'ok' } },
  ];
  let i = 0;
  const calls = [];
  const r = await run({ goal: 'Sign in', limits: { maxSteps: 5, taskTimeoutMs: 5000, modelTimeoutMs: 1000,
    stepTimeoutMs: 500, approvalTimeoutMs: 800 }, isStopped: async () => false,
  decide: async () => JSON.stringify(replies[i++]),
  command: async (name, args, o) => { calls.push({ name, say: o.say });
    return name === 'get_page_content' ? { ok: true, result: { url: 'https://a.ng/', title: 'A', text: 'Hi',
      elements: [{ id: 'c1', tag: 'a', text: 'Open menu', href: 'https://a.ng/menu' }] } }
      : { ok: true, result: { changed: 'navigated', url: 'https://a.ng/menu' } }; } });
  assert.equal(r.status, 'done');
  assert.deepEqual(calls, [{ name: 'get_page_content', say: 'Reading the page' },
    { name: 'click', say: 'Clicking Sign in' }]);
});

test('the model hears when typing or scrolling did not happen on the phone', () => {
  const guard = safety.collector();
  const fill = { tool: 'fill', name: 'fill', args: { id: 'c2', value: 'rice' } };
  const scroll = { tool: 'scroll', name: 'scroll', args: { direction: 'down' } };
  assert.match(prompt.observe(fill, { ok: true, result: { typed: false } }, { guard, pages: [] }).text,
    /did NOT take the text/);
  assert.match(prompt.observe(fill, { ok: true, result: { typed: true, url: 'https://a.ng/' } },
    { guard, pages: [] }).text, /^Result of fill: done\. Now at https:\/\/a\.ng\//);
  assert.match(prompt.observe(scroll, { ok: true, result: { moved: false, y: 0 } }, { guard, pages: [] }).text,
    /nothing moved/);
  assert.equal(prompt.observe(scroll, { ok: true, result: { moved: true, y: 640 } }, { guard, pages: [] }).text,
    'Result of scroll: done.');
  // Older phones send neither flag: as before.
  assert.equal(prompt.observe(scroll, { ok: true, result: { y: 640, max: 2000 } }, { guard, pages: [] }).text,
    'Result of scroll: done.');
});
