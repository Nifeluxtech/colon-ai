// 0.11.2, the server's half: Saga and pop-ups (prompt.observe shows the pop-up and what it blocks, tools.toCommand
// refuses an element behind it, a refused tap is explained, the rules say what to do with cookie banners) and the
// latency changes (every mode reads the page for Saga after it changes, waiting for the load in short polls; the
// screenshot tool, whose picture never reached the model, is no longer offered). Scripted model and phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');
const prompt = require('../../src/modules/saga/prompt');
const tools = require('../../src/modules/saga/tools');
const secrets = require('../../src/modules/saga/secrets');
const safety = require('../../src/modules/safety');

console.log = () => {};
const LIMITS = { maxSteps: 10, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const J = (o) => JSON.stringify(o);
const FIN = { say: 'Done', action: 'finish', args: { answer: 'Done.' } };
const text = (msgs) => msgs.map((m) => m.content).join('\n');
function model(replies) {
  const seen = [];
  return { seen, decide: async (messages) => { seen.push(messages);
    return J(replies[Math.min(seen.length - 1, replies.length - 1)]); } };
}
function phone(map = {}) {
  const calls = [];
  return { calls, command: async (name, args) => { calls.push({ name, args }); const a = map[name];
    return typeof a === 'function' ? a(args) : a || { ok: true, result: {} }; } };
}
const go = (o) => run({ goal: 'Search for yolotask earners', limits: LIMITS, isStopped: async () => false, ...o });

const CONSENT = { url: 'https://www.google.com/search?q=yolotask+earners', title: 'yolotask earners - Google Search',
  text: 'Pop-up: Before you continue to Google … | Page behind it: YOLOTASK — Earn and grow online',
  overlay: { label: 'Before you continue to Google', kind: 'modal', frame: false },
  elements: [{ id: 'c1', tag: 'button', text: 'Reject all', form: true, in_popup: true },
    { id: 'c2', tag: 'button', text: 'Accept all', form: true, in_popup: true },
    { id: 'c3', tag: 'a', text: 'YOLOTASK — Earn and grow online', href: 'https://yolotask.com.ng/', blocked: true }] };

test('the snapshot says a pop-up is open, lists its elements as "in the pop-up" and marks what it blocks', () => {
  const guard = safety.collector();
  const ob = prompt.observe({ tool: 'getPageContent', name: 'get_page_content' },
    { ok: true, result: secrets.redactContent(CONSENT) }, { guard, pages: [], id: 'x1' });
  assert.match(ob.text, /A pop-up is open over this page and blocks it/);
  assert.match(ob.text, /Pop-up: Before you continue to Google/);
  assert.match(ob.text, /c1: button "Reject all" \(in a form\) \(in the pop-up\)/);
  assert.match(ob.text, /c3: a "YOLOTASK — Earn and grow online" \(behind the pop-up\)/);
  assert.deepEqual(ob.overlay, { label: 'Before you continue to Google', kind: 'modal', frame: false });
  assert.equal(ob.elements.get('c3').blocked, true);
  assert.equal(ob.elements.get('c1').in_popup, true);
  const frame = prompt.observe({ tool: 'getPageContent', name: 'get_page_content' }, { ok: true, result: {
    ...CONSENT, overlay: { label: 'Consent', kind: 'modal', frame: true } } }, { guard, pages: [] });
  assert.match(frame.text, /requestUserControl \(reason "consent"\)/);
});

test('a click on an element behind the pop-up is refused before it reaches the phone', () => {
  const guard = safety.collector();
  const { elements } = prompt.observe({ tool: 'getPageContent', name: 'get_page_content' },
    { ok: true, result: CONSENT }, { guard, pages: [] });
  assert.throws(() => tools.toCommand('click', { id: 'c3' }, { elements }), /behind the pop-up/);
  assert.throws(() => tools.toCommand('fill', { id: 'c3', value: 'x' }, { elements }), /Reject all/);
  assert.deepEqual(tools.toCommand('click', { id: 'c1' }, { elements }).args, { id: 'c1' });
});

test('the loop: Saga rejects the cookies first, the page is read for it, and a refused tap is explained', async () => {
  const m = model([
    { say: 'Reading the results', action: 'getPageContent', args: {} },
    { say: 'Checking the results', action: 'click', args: { id: 'c3' } },     // refused here: behind the pop-up
    { say: 'Declining cookies', action: 'click', args: { id: 'c1' } },
    { say: 'Opening YOLOTASK', action: 'click', args: { id: 'c9' } }, FIN]);
  let reads = 0;
  const after = { ...CONSENT, overlay: null, text: 'YOLOTASK — Earn and grow online',
    elements: [{ id: 'c9', tag: 'a', text: 'YOLOTASK', href: 'https://yolotask.com.ng/' }] };
  const p = phone({ get_page_state: { ok: true, result: { loading: false } },
    get_page_content: () => ({ ok: true, result: reads++ ? after : CONSENT }),
    click: (a) => (a.id === 'c9' ? { ok: false, error: 'covered' }
      : { ok: true, result: { changed: 'page_changed' } }) });
  const r = await go({ decide: m.decide, command: p.command, autoRead: true });
  assert.equal(r.status, 'done');
  assert.equal(m.seen.length, 5);
  assert.match(text(m.seen[2]), /That action was refused: Element c3 is behind the pop-up/);
  // The click on "Reject all" changed the page: it was read for Saga (no model call asked for it).
  assert.deepEqual(p.calls.map((c) => c.name).filter((n) => n !== 'get_page_state'), ['get_page_content', 'click',
    'get_page_content', 'click']);
  assert.match(text(m.seen[3]), /c9: a "YOLOTASK"/);
  assert.match(text(m.seen[4]), /NOT done: that element is behind a pop-up/);
});

test('autoRead waits for the page to load in short polls; without it (and speed mode) nothing is read', async () => {
  let loading = 3;
  const p = phone({ get_page_state: () => ({ ok: true, result: { loading: loading-- > 0 } }),
    get_page_content: { ok: true, result: { url: 'https://a.ng/', title: 'A', text: 'Hi', elements: [] } } });
  const t0 = Date.now();
  const m = model([{ say: 'Opening', action: 'openUrl', args: { url: 'https://a.ng/' } }, FIN]);
  await go({ decide: m.decide, command: p.command, autoRead: true });
  assert.deepEqual(p.calls.map((c) => c.name), ['open_url', 'get_page_state', 'get_page_state', 'get_page_state',
    'get_page_state', 'get_page_content']);
  assert.ok(Date.now() - t0 < 1500);                                 // 3 × 350 ms, not 3 × 750 ms
  assert.equal(m.seen.length, 2);
  const q = phone();
  await go({ decide: model([{ say: 'Opening', action: 'openUrl', args: { url: 'https://a.ng/' } }, FIN]).decide,
    command: q.command });
  assert.deepEqual(q.calls.map((c) => c.name), ['open_url']);
});

test('the rules: pop-ups first, cookie banners declined; no screenshot tool (its picture never reached the model)',
  () => {
    const s = prompt.system({ maxSteps: 10 });
    assert.match(s, /Pop-ups come first/);
    assert.match(s, /click "Reject all"/);
    assert.match(s, /Colon reads the page for you/);
    assert.doesNotMatch(s, /cookie choice that is theirs/);
    assert.ok(!tools.available(null).includes('screenshot'));
    assert.doesNotMatch(s, /- screenshot \{/);
    assert.equal(tools.toCommand('screenshot', {}).name, 'screenshot');   // older routines still parse
  });
