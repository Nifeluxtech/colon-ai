// Phase 9 release standard, "approvals can't be bypassed": payments, purchases, form submissions, sending messages
// and personal data need the user's tap on the phone (modules/saga/policy.js + loop.js). The model can't pre-approve,
// rename or skip an approval; the server never treats an action as approved unless the phone says the user tapped
// Allow; a decline is respected; typed personal data never reaches the audit log.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');
const policy = require('../../src/modules/saga/policy');

console.log = () => {};
const LIMITS = { maxSteps: 6, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 300, approvalTimeoutMs: 900 };
const EL = [
  { id: 'c1', tag: 'button', text: 'Pay ₦12,500', form: true },
  { id: 'c2', tag: 'input', type: 'email', label: 'Email address', form: true },
  { id: 'c3', tag: 'a', text: 'Read more', href: 'https://shop.ng/p/1' },
  { id: 'c4', tag: 'button', type: 'submit', text: 'Go', form: true },
  { id: 'c5', tag: 'input', type: 'text', label: 'Search', form: true },
  { id: 'c6', tag: 'button', text: 'Send message' },
  { id: 'c7', tag: 'button', text: 'Add to cart' },
];
const els = new Map(EL.map((e) => [e.id, e]));

function script(actions, acks) {
  let i = 0;
  const calls = [], rows = [], seen = [];
  return {
    calls, rows, seen,
    run: () => run({ goal: 'Buy the blender', limits: LIMITS, isStopped: async () => false,
      log: async (e) => { rows.push(e); },
      decide: async (m) => { seen.push(m); return JSON.stringify(actions[Math.min(i++, actions.length - 1)]); },
      command: async (name, args, o) => { calls.push({ name, args, o });
        const a = acks[name]; return typeof a === 'function' ? a(args) : a || { ok: true, result: {} }; } }),
  };
}
const read = { action: 'getPageContent', args: {} };
const content = { ok: true, result: { url: 'https://shop.ng/cart', title: 'Cart', text: 'Total ₦12,500',
  elements: EL } };
const done = { action: 'finish', args: { answer: 'Stopped at checkout.' } };

test('policy: what needs approval, and what does not', () => {
  const k = (cmd) => (policy.approval(cmd, { elements: els }) || {}).kind || null;
  assert.equal(k({ name: 'click', args: { id: 'c1' } }), 'payment');
  assert.equal(k({ name: 'click', args: { id: 'c7' } }), 'purchase');
  assert.equal(k({ name: 'click', args: { id: 'c6' } }), 'send_message');
  assert.equal(k({ name: 'click', args: { id: 'c4' } }), 'form_submission');
  assert.equal(k({ name: 'click', args: { id: 'c3' } }), null, 'a plain link only navigates');
  assert.equal(k({ name: 'fill', args: { id: 'c2', value: 'x' } }), 'personal_data', 'email field');
  assert.equal(k({ name: 'fill', args: { id: 'c5', value: 'blender price' } }), null);
  assert.equal(k({ name: 'fill', args: { id: 'c5', value: 'call 08031234567' } }), 'personal_data');
  assert.equal(k({ name: 'fill', args: { id: 'c5', value: '4111 1111 1111 1111' } }), 'personal_data');
  assert.equal(k({ name: 'fill', args: { id: 'c5', value: 'blender', submit: true } }), 'form_submission');
  assert.equal(k({ name: 'open_url', args: { url: 'https://x.ng/?email=ada@example.com' } }), 'personal_data');
  assert.equal(k({ name: 'open_url', args: { url: 'https://x.ng/?q=blender' } }), null);
  assert.equal(k({ name: 'fill', args: { id: 'c5', value: 'my BVN is 22212345678' } }), 'personal_data');
  assert.equal(policy.stronger({ kind: 'personal_data' }, { kind: 'payment' }).kind, 'payment');
  assert.ok(policy.luhn('4111111111111111') && !policy.luhn('4111111111111112'));
});

test('the model cannot pre-approve: its approval arguments are dropped, the server attaches the real one', async () => {
  const s = script([read, { say: 'Paying', action: 'click', args: { id: 'c1', approval: null, approved: true,
    skipApproval: true } }, done], { get_page_content: content,
    click: { ok: true, result: { approval: 'approved', url: 'https://shop.ng/paid' } } });
  const r = await s.run();
  assert.equal(r.status, 'done');
  const click = s.calls.find((c) => c.name === 'click');
  assert.deepEqual(Object.keys(click.args).sort(), ['approval', 'id']);
  assert.equal(click.args.approval.kind, 'payment');
  assert.equal(click.o.timeoutMs, LIMITS.approvalTimeoutMs, 'waits long enough for a tap');
  const row = s.rows.find((x) => x.name === 'click');
  assert.equal(row.approval, 'payment');
  assert.equal(row.approved, 'approved');
});

test('an ok answer without the user\'s approval ends the task: approval_missing', async () => {
  const s = script([read, { action: 'click', args: { id: 'c1' } }, done], { get_page_content: content,
    click: { ok: true, result: { url: 'https://shop.ng/paid' } } });
  const r = await s.run();
  assert.equal(r.status, 'failed');
  assert.equal(r.error, 'approval_missing');
  assert.equal(s.rows.at(-1).error, 'approval_missing');
  // A forged approval value is not "approved" either.
  const s2 = script([read, { action: 'fill', args: { id: 'c5', value: 'x', submit: true } }, done], {
    get_page_content: content, fill: { ok: true, result: { approval: 'yes' } } });
  assert.equal((await s2.run()).error, 'approval_missing');
});

test('a decline is respected: Saga is told not to try another way, and the log says denied', async () => {
  const s = script([read, { action: 'click', args: { id: 'c7' } }, done], { get_page_content: content,
    click: { ok: false, error: 'approval_denied' } });
  const r = await s.run();
  assert.equal(r.status, 'done');
  assert.match(s.seen[2].at(-1).content, /declined this action/);
  const row = s.rows.find((x) => x.name === 'click');
  assert.equal(row.approved, 'denied');
  assert.equal(row.ok, false);
});

test('the phone can ask on its own (it checks the real element) and that approval is logged', async () => {
  const s = script([read, { action: 'click', args: { id: 'c3' } }, done], { get_page_content: content,
    click: { ok: true, result: { approval: 'approved', approval_kind: 'purchase' } } });
  await s.run();
  const click = s.calls.find((c) => c.name === 'click');
  assert.equal(click.args.approval, undefined);
  const row = s.rows.find((x) => x.name === 'click');
  assert.equal(row.approval, 'purchase');
  assert.equal(row.approved, 'approved');
});

test('typed personal data is hidden in the audit log; ordinary search text is kept', async () => {
  const s = script([read, { action: 'fill', args: { id: 'c2', value: 'ada@example.com' } },
    { action: 'fill', args: { id: 'c5', value: 'blender price' } }, done], { get_page_content: content,
    fill: { ok: true, result: { approval: 'approved' } } });
  await s.run();
  const fills = s.rows.filter((x) => x.name === 'fill');
  assert.equal(fills[0].args.value, '[hidden: 15 characters]');
  assert.ok(!JSON.stringify(s.rows).includes('ada@example.com'));
  assert.equal(fills[1].args.value, 'blender price');
});

test('after a page changes, old element ids are gone: Saga must read again before clicking', async () => {
  const s = script([read, { action: 'openUrl', args: { url: 'https://shop.ng/checkout' } },
    { action: 'click', args: { id: 'c1' } }, done], { get_page_content: content });
  await s.run();
  assert.ok(!s.calls.some((c) => c.name === 'click'));
  assert.ok(s.rows.some((x) => x.error === 'bad_action' && x.tool === 'click'));
});
