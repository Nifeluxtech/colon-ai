// Saga hands secret fields to the user (Phase 10, modules/saga/loop.js + secrets.js): an action on a password, code,
// card or PIN field is never sent to the phone; the loop waits for the user's Return to AI and continues, or ends
// when the user stops; the phone's own refusal (ack secret_field) is handled the same way; observations are
// redacted; and in "AI + me" (shared) the model is told when the user moved the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');

console.log = () => {};
const LIMITS = { maxSteps: 10, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const SIGN_IN = { ok: true, result: { url: 'https://shop.ng/account', title: 'Sign in',
  text: 'Sign in. Your OTP is 552019.', elements: [
    { id: 'c1', tag: 'input', type: 'email', label: 'Email', form: true, form_secret: 'password' },
    { id: 'c2', tag: 'input', type: 'password', label: 'Password', form: true, value: 'should-never-pass' },
    { id: 'c3', tag: 'button', type: 'submit', text: 'Log in', form: true }] } };

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
  return run({ goal: 'Check my order status on shop.ng', limits: LIMITS, isStopped: async () => false,
    log: async (e) => { rows.push(e); }, ...o }).then((r) => ({ ...r, rows }));
};
const all = (seen) => seen.map((ms) => ms.map((m) => m.content).join('\n')).join('\n');

test('a password field is handed to the user: no fill is sent, Saga resumes after Return to AI', async () => {
  const m = model([
    { say: 'Reading the sign-in page', action: 'getPageContent', args: {} },
    { say: 'Typing the password', action: 'fill', args: { id: 'c2', value: 'guess' } },
    { say: 'Reading the page again', action: 'getPageContent', args: {} },
    { say: 'Done', action: 'finish', args: { answer: 'Your order is on its way [1].', sources: [1] } },
  ]);
  const p = phone({ get_page_content: SIGN_IN });
  const handed = [];
  const r = await go({ decide: m.decide, command: p.command, handoff: async (info, o) => { handed.push([info, o]);
    return 'return_to_ai'; } });
  assert.equal(r.status, 'done');
  assert.deepEqual(p.calls.map((c) => c.name), ['get_page_content', 'get_page_content']);
  assert.equal(handed.length, 1);
  assert.equal(handed[0][0].kind, 'password');
  assert.equal(handed[0][0].message, 'Enter your password here, then tap Return to AI.');
  assert.equal(handed[0][1].phoneStarted, false);
  const h = r.rows.find((x) => x.kind === 'handoff');
  assert.equal(h.say, 'Enter your password here, then tap Return to AI.');
  assert.equal(h.error, 'password');
  // The model was told the user typed it, never saw the field's value or the code on the page.
  assert.match(all(m.seen), /gave control back/);
  assert.doesNotMatch(all(m.seen), /should-never-pass|552019/);
  assert.match(all(m.seen), /c2: input\[password\] "Password" \(in a form\) \(secret: the user types this/);
});

test('typing into another field of a sign-in form is handed over too; Stop during the wait ends the task', async () => {
  const m = model([
    { say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Typing your email', action: 'fill', args: { id: 'c1', value: 'ada@example.ng' } },
  ]);
  const p = phone({ get_page_content: SIGN_IN });
  const r = await go({ decide: m.decide, command: p.command, handoff: async () => 'stop' });
  assert.equal(r.status, 'interrupted');
  assert.equal(r.error, 'stop');
  assert.ok(!p.calls.some((c) => c.name === 'fill'));
  const timedOut = await go({ decide: model([{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Typing', action: 'fill', args: { id: 'c2', value: 'x' } }]).decide, command: p.command,
  handoff: async () => 'timeout' });
  assert.equal(timedOut.error, 'handoff_timeout');
  // Without a handoff hook (an old runner) the task ends rather than typing.
  const none = await go({ decide: model([{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Typing', action: 'fill', args: { id: 'c2', value: 'x' } }]).decide, command: p.command });
  assert.equal(none.status, 'interrupted');
  assert.equal(none.error, 'secret_field');
});

test('the phone\'s own refusal (ack secret_field) waits for the user the same way', async () => {
  const page = { ok: true, result: { url: 'https://bank.ng/verify', title: 'Verify', text: 'Enter the code',
    elements: [{ id: 'c1', tag: 'input', label: 'Code' }] } };
  const m = model([
    { say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Typing the code', action: 'fill', args: { id: 'c1', value: '1234' } },
    { say: 'Done', action: 'finish', args: { answer: 'Verified.' } },
  ]);
  const p = phone({ get_page_content: page, fill: { ok: false, error: 'secret_field',
    result: { kind: 'one_time_code' } } });
  const handed = [];
  const r = await go({ decide: m.decide, command: p.command, handoff: async (info, o) => { handed.push([info, o]);
    return 'return_to_ai'; } });
  assert.equal(r.status, 'done');
  assert.equal(handed[0][1].phoneStarted, true);
  assert.equal(handed[0][0].kind, 'one_time_code');
});

test('sign-in hosts are never opened by Saga; the user signs in themselves', async () => {
  const m = model([{ say: 'Opening Google sign-in', action: 'openUrl', args: { url: 'https://accounts.google.com/' } },
    { say: 'Done', action: 'finish', args: { answer: 'Signed in.' } }]);
  const p = phone();
  const r = await go({ decide: m.decide, command: p.command, handoff: async () => 'return_to_ai' });
  assert.equal(r.status, 'done');
  assert.equal(p.calls.length, 0);
});

test('AI + me: when the user moves the page, Saga is told and its old element ids are dropped', async () => {
  let state = null;
  const m = model([
    { say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Scrolling', action: 'scroll', args: { direction: 'down' } },
    { say: 'Clicking', action: 'click', args: { id: 'c3' } },
    { say: 'Done', action: 'finish', args: { answer: 'ok' } },
  ]);
  const p = phone({ get_page_content: SIGN_IN, scroll: () => { state = { url: 'https://shop.ng/orders', title:
    'My orders', at: Date.now() + 5 }; return { ok: true, result: { y: 100, max: 900 } }; } });
  const r = await go({ decide: m.decide, command: p.command, mode: 'shared', pageState: () => state });
  assert.match(all(m.seen), /The user changed the page in the browser: it is now https:\/\/shop\.ng\/orders/);
  // The click on c3 was refused (its id is from the page the user left), not sent.
  assert.ok(!p.calls.some((c) => c.name === 'click'));
  assert.equal(r.status, 'done');
  // In AI-only mode the same report is ignored.
  const m2 = model([{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Done', action: 'finish', args: { answer: 'ok' } }]);
  await go({ decide: m2.decide, command: phone({ get_page_content: SIGN_IN }).command, mode: 'ai',
    pageState: () => ({ url: 'https://elsewhere.ng/', at: Date.now() + 99999 }) });
  assert.doesNotMatch(all(m2.seen), /The user changed the page/);
});
