// Saga's click results (0.10.1): the phone reports what a tap changed (result.changed), the model is told plainly
// when nothing changed (so it retries or picks another element instead of assuming success), and the element ids
// from the last getPageContent stay usable after a click that left the page as it was.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');
const prompt = require('../../src/modules/saga/prompt');
const safety = require('../../src/modules/safety');

console.log = () => {};
const LIMITS = { maxSteps: 8, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const J = (o) => JSON.stringify(o);
const ELS = [{ id: 'c1', tag: 'button', text: 'Show more' }, { id: 'c2', tag: 'a', text: 'Prices',
  href: 'https://shop.ng/prices' }];
const page = { ok: true, result: { url: 'https://shop.ng/', title: 'Shop', text: 'Welcome', elements: ELS } };
const click = (id) => ({ action: 'click', args: { id } });

function model(replies) {
  const seen = [];
  return { seen, decide: async (messages) => { seen.push(messages); return J(replies[Math.min(seen.length - 1,
    replies.length - 1)]); } };
}
function phone(clicks) {
  const calls = [];
  let i = 0;
  return { calls, command: async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_page_content') return page;
    if (name === 'click') return clicks[Math.min(i++, clicks.length - 1)];
    return { ok: true, result: {} };
  } };
}
const go = (m, p) => run({ goal: 'Find the prices', limits: LIMITS, isStopped: async () => false, decide: m.decide,
  command: p.command });
const cmd = { tool: 'click', name: 'click', args: { id: 'c1' } };
const observe = (result, ok = true) => prompt.observe(cmd, { ok, result, error: ok ? null : result },
  { guard: safety.collector(), pages: [] }).text;

test('the model hears what a click changed, and is told plainly when it changed nothing', () => {
  assert.match(observe({ url: 'https://shop.ng/p', changed: 'navigated', method: 'tap' }), /new page opened/);
  assert.match(observe({ url: 'https://shop.ng/', changed: 'page_changed' }), /content changed/);
  assert.match(observe({ changed: 'element_changed' }), /changed state/);
  const none = observe({ url: 'https://shop.ng/', changed: 'none', method: 'tap' });
  assert.match(none, /NOTHING on the page changed/);
  assert.match(none, /Try another element/);
  assert.doesNotMatch(none, /: done\./);
  assert.match(observe({ changed: 'none', covered: 'Accept cookies' }), /Something was over the element .*Accept/);
  // An older phone sends no `changed`: the old wording stays.
  assert.match(observe({ url: 'https://shop.ng/' }), /done\. Call getPageContent/);
  // Failures stay failures (element gone, page error).
  assert.match(observe('no_element', false), /failed \(no_element\)/);
});

test('after a click that changed nothing, the same element ids still work (retry or pick another)', async () => {
  const m = model([{ action: 'getPageContent', args: {} }, click('c1'), click('c2'),
    { action: 'finish', args: { answer: 'ok' } }]);
  const p = phone([{ ok: true, result: { url: 'https://shop.ng/', changed: 'none', method: 'tap' } },
    { ok: true, result: { url: 'https://shop.ng/prices', changed: 'navigated', method: 'tap' } }]);
  const r = await go(m, p);
  assert.equal(r.status, 'done');
  assert.deepEqual(p.calls.map((c) => c.name), ['get_page_content', 'click', 'click']);
  assert.match(m.seen[2].at(-1).content, /NOTHING on the page changed/);
});

test('after a click that changed the page, old element ids are refused until the page is read again', async () => {
  const m = model([{ action: 'getPageContent', args: {} }, click('c1'), click('c2'),
    { action: 'finish', args: { answer: 'ok' } }]);
  const p = phone([{ ok: true, result: { url: 'https://shop.ng/', changed: 'page_changed', method: 'tap' } }]);
  const r = await go(m, p);
  assert.equal(r.status, 'done');
  assert.deepEqual(p.calls.map((c) => c.name), ['get_page_content', 'click']);
  assert.match(m.seen[3].at(-1).content, /getPageContent first/);
});

test('an element that is gone is reported as a failed click, not as done', async () => {
  const m = model([{ action: 'getPageContent', args: {} }, click('c1'), { action: 'finish', args: { answer: 'ok' } }]);
  const p = phone([{ ok: false, error: 'no_element' }]);
  await go(m, p);
  assert.match(m.seen[2].at(-1).content, /Result of click: failed \(no_element\)/);
});
