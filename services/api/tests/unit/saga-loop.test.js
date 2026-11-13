// Saga's browsing loop (modules/saga/loop.js, Phase 9): decision -> action -> observation with step limits,
// task / model / phone timeouts, reply parsing and repair, Stop and Take control, and citations of the pages read.
// The model and the phone are scripted fakes; no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');
const { parseDecision } = require('../../src/modules/saga/parse');
const tools = require('../../src/modules/saga/tools');

console.log = () => {};
const LIMITS = { maxSteps: 8, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const J = (o) => JSON.stringify(o);
const page = (url, title, text, elements = []) => ({ ok: true, result: { url, title, text, elements } });

// A scripted model: each call returns the next reply (a string, an object, or a function of the messages).
function model(replies) {
  const seen = [];
  const decide = async (messages, signal) => {
    seen.push(messages);
    const r = replies[Math.min(seen.length - 1, replies.length - 1)];
    const v = typeof r === 'function' ? await r(messages, signal) : r;
    return typeof v === 'string' ? v : J(v);
  };
  return { decide, seen };
}
// A scripted phone: name -> ack (or function(args) -> ack).
function phone(map = {}) {
  const calls = [];
  const command = async (name, args, o) => {
    calls.push({ name, args, o });
    const a = map[name];
    return typeof a === 'function' ? a(args, o) : a || { ok: true, result: {} };
  };
  return { command, calls };
}
const logger = () => { const rows = []; return { rows, log: async (e) => { rows.push(e); } }; };
const go = (o) => run({ goal: 'Find the CBN exchange rate today', limits: LIMITS, isStopped: async () => false, ...o });

test('a three-step task: open, read, finish with the pages it used as numbered sources', async () => {
  const m = model([
    { say: 'Opening the CBN site', action: 'openUrl', args: { url: 'https://www.cbn.gov.ng/rates/' } },
    { say: 'Reading the rates', action: 'getPageContent', args: {} },
    { say: 'Done', action: 'finish', args: { answer: 'The official rate is ₦1,500/$ [1].', sources: [1] } },
  ]);
  const p = phone({ open_url: { ok: true, result: { url: 'https://www.cbn.gov.ng/rates/', title: 'Rates' } },
    get_page_content: page('https://www.cbn.gov.ng/rates/', 'Exchange Rates', 'USD 1500.00') });
  const l = logger();
  const r = await go({ decide: m.decide, command: p.command, log: l.log });
  assert.equal(r.status, 'done');
  assert.equal(r.steps, 3);
  assert.match(r.answer, /\[1\]/);
  assert.deepEqual(r.sources, [{ n: 1, title: 'Exchange Rates', url: 'https://www.cbn.gov.ng/rates/' }]);
  assert.deepEqual(p.calls.map((c) => c.name), ['open_url', 'get_page_content']);
  // Every step is logged with Saga's explanation, and the page it read.
  const acts = l.rows.filter((x) => x.kind === 'action');
  assert.deepEqual(acts.map((x) => x.say), ['Opening the CBN site', 'Reading the rates']);
  assert.equal(acts[1].page, 1);
  assert.equal(l.rows.at(-1).kind, 'finish');
});

test('the step limit stops a model that never finishes', async () => {
  const m = model([{ say: 'Scrolling', action: 'scroll', args: { direction: 'down' } }]);
  const p = phone();
  const l = logger();
  const r = await go({ decide: m.decide, command: p.command, log: l.log, limits: { ...LIMITS, maxSteps: 4 } });
  assert.equal(r.status, 'step_limit');
  assert.equal(r.steps, 4);
  assert.equal(p.calls.length, 4);
  assert.match(r.answer, /4 steps/);
  assert.equal(l.rows.at(-1).status, 'step_limit');
});

test('the task timeout ends a slow task, and a model that hangs times out twice then fails', async () => {
  let clock = 0;
  const slow = model([{ say: 's', action: 'scroll', args: {} }]);
  const p = phone({ scroll: async () => { clock += 3000; return { ok: true, result: {} }; } });
  const r = await go({ decide: slow.decide, command: p.command, now: () => clock });
  assert.equal(r.status, 'timeout');
  assert.equal(r.error, 'task_timeout');
  assert.equal(r.steps, 2);

  let aborted = 0;
  const hang = model([(_, signal) => new Promise((res, rej) => { signal.addEventListener('abort', () => { aborted++;
    rej(new Error('aborted')); }); })]);
  const t0 = Date.now();
  const r2 = await go({ decide: hang.decide, command: phone().command, limits: { ...LIMITS, modelTimeoutMs: 60 } });
  assert.equal(r2.status, 'failed');
  assert.equal(r2.error, 'model_timeout');
  assert.equal(aborted, 2, 'the hung model call is aborted');
  assert.ok(Date.now() - t0 < 1000);
});

test('the phone timing out twice in a row fails the task; one timeout is just an observation', async () => {
  const m = model([{ say: 'r', action: 'refresh', args: {} }]);
  let n = 0;
  const p = phone({ reload: () => (++n === 1 ? { ok: false, error: 'timeout' } : n === 2 ? { ok: true, result: {} }
    : { ok: false, error: 'timeout' }) });
  const r = await go({ decide: m.decide, command: p.command });
  assert.equal(r.status, 'failed');
  assert.equal(r.error, 'phone_timeout');
  assert.equal(n, 4);
  assert.equal(p.calls[0].o.timeoutMs, LIMITS.stepTimeoutMs);
});

test('replies that are not JSON are repaired, and three in a row fail', async () => {
  const fenced = 'Sure!\n```json\n{"say":"Reading","action":"getPageContent","args":{}}\n```';
  const m = model(['I will now open the page.', fenced, { action: 'finish', answer: 'Nothing found.' }]);
  const p = phone({ get_page_content: page('https://a.ng/', 'A', 'x') });
  const r = await go({ decide: m.decide, command: p.command });
  assert.equal(r.status, 'done');
  assert.equal(r.answer, 'Nothing found.');
  assert.match(m.seen[1].at(-1).content, /ONE JSON object/);
  const bad = model(['no', 'still no', 'nope']);
  const r2 = await go({ decide: bad.decide, command: phone().command });
  assert.equal(r2.status, 'failed');
  assert.equal(r2.error, 'bad_reply');
});

test('parseDecision accepts the usual model deviations', () => {
  assert.deepEqual(parseDecision('<think>hmm {"x":1}</think>{"tool":"openUrl",'
    + '"arguments":"{\\"url\\":\\"https://a.ng\\"}","explain":"go"}'),
  { say: 'go', action: 'openUrl', args: { url: 'https://a.ng' } });
  assert.deepEqual(parseDecision('{"action":"finish","answer":"Hi [1]","sources":[1]}').args,
    { answer: 'Hi [1]', sources: [1] });
  assert.throws(() => parseDecision('{"say":"no action"}'), { code: 'bad_reply' });
});

test('unknown tools, bad URLs and elements Saga never saw are refused without reaching the phone', async () => {
  const m = model([
    { action: 'runScript', args: { code: 'alert(1)' } },
    { action: 'openUrl', args: { url: 'javascript:alert(1)' } },
    { action: 'openUrl', args: { url: 'file:///etc/passwd' } },
    { action: 'click', args: { id: 'c3' } },
    { action: 'finish', args: { answer: 'ok' } },
  ]);
  const p = phone();
  const l = logger();
  const r = await go({ decide: m.decide, command: p.command, log: l.log });
  assert.equal(r.status, 'done');
  assert.equal(p.calls.length, 0);
  assert.equal(l.rows.filter((x) => x.error === 'bad_action').length, 4);
  assert.match(m.seen[4].at(-1).content, /getPageContent first/);
  assert.throws(() => tools.toCommand('openUrl', { url: 'https://user:pw@bank.ng/' }), { code: 'bad_action' });
});

test('Stop ends the task before the next step; Take control interrupts it at once', async () => {
  let stop = false;
  const m = model([async () => { stop = true; return { action: 'scroll', args: {} }; }]);
  const r = await go({ decide: m.decide, command: phone().command, isStopped: async () => stop });
  assert.equal(r.status, 'stopped');
  assert.equal(r.steps, 1);
  for (const error of ['manual_control', 'paused', 'disconnected']) {
    const r2 = await go({ decide: model([{ action: 'back', args: {} }]).decide, command: phone({ back: { ok: false,
      error } }).command });
    assert.equal(r2.status, 'interrupted');
    assert.equal(r2.error, error);
    assert.equal(r2.steps, 1);
  }
});

test('finish without sources cites every page read; invented page numbers are dropped', async () => {
  const m = model([
    { action: 'getPageContent', args: {} }, { action: 'openUrl', args: { url: 'https://b.ng/' } },
    { action: 'getPageContent', args: {} }, { action: 'finish', args: { answer: 'A and B', sources: [7] } },
  ]);
  let k = 0;
  const p = phone({ get_page_content: () => (++k === 1 ? page('https://a.ng/', 'A', 'a') : page('https://b.ng/', 'B',
    'b')) });
  const r = await go({ decide: m.decide, command: p.command });
  assert.deepEqual(r.sources.map((s) => s.url), ['https://a.ng/', 'https://b.ng/']);
});

test('blocked sites are never opened', async () => {
  const m = model([{ action: 'openUrl', args: { url: 'https://www.pornhub.com/' } }, { action: 'finish', args: {
    answer: 'x' } }]);
  const p = phone();
  const r = await go({ decide: m.decide, command: p.command });
  assert.equal(r.status, 'done');
  assert.equal(p.calls.length, 0);
});
