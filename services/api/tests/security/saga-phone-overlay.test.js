// 0.11.2: Saga and pop-ups, the phone's half (apps/android/app/src/main/assets/saga/overlay.js with tools.js), on a
// fake DOM with geometry and stacking. Owner's report on 0.11.1: Google's "Before you continue to Google" cookie
// dialog covered the results and Saga kept pointing at a result behind it ("I'm checking the current search
// results…") and got nowhere. The snapshot now lists the pop-up's elements first and marks what it covers; a tap on
// something behind it is refused (error covered) instead of being made; its decline button needs no approval.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { node, page } = require('../helpers/fake-dom');
const policy = require('../../src/modules/saga/policy');

const DIR = path.resolve(__dirname, '../../../../apps/android/app/src/main/assets/saga');
const TOOLS = fs.readFileSync(path.join(DIR, 'tools.js'), 'utf8');
const OVERLAY = fs.readFileSync(path.join(DIR, 'overlay.js'), 'utf8');

function rig(root, o = {}) {
  const p = page(root, o);
  const ctx = vm.createContext({ document: p.document, window: p.window });
  const fn = vm.runInContext(TOOLS, ctx), ovl = o.noOverlay ? undefined : vm.runInContext(OVERLAY, ctx);
  return { ...p, run: (cmd, args = {}) => JSON.parse(fn(cmd, args, undefined, ovl)) };
}
const box = (left, top, width, height) => ({ left, top, width, height });
function results(n) {
  return node('div', { rect: box(0, 0, 400, 3000), kids: Array.from({ length: n }, (_, i) => node('a', {
    attrs: { href: `https://site${i}.ng/` }, text: `Result ${i + 1}`, rect: box(20, 100 + i * 40, 300, 30) })) });
}
// Google's consent dialog: a dimmed full-screen backdrop and the dialog box over it, after the results in the DOM.
function google(o = {}) {
  const form = {};
  const btn = (text, top) => Object.assign(node('button', { text, rect: box(60, top, 280, 40) }), { form });
  const dialog = node('div', { attrs: { role: 'dialog', ...(o.ariaModal ? { 'aria-modal': 'true' } : {}) },
    rect: box(30, 250, 340, 450), position: 'fixed', z: 11, kids: [
      node('h1', { text: 'Before you continue to Google', rect: box(40, 260, 320, 30) }),
      node('p', { text: 'We use cookies and data to deliver and maintain Google services', rect: box(40, 300, 320,
        200) }),
      btn('Reject all', 600), btn('Accept all', 645),
      node('a', { attrs: { href: 'https://consent.google.com/more' }, text: 'More options', rect: box(60, 690, 200,
        8) })] });
  const backdrop = node('div', { rect: box(0, 0, 400, 800), position: 'fixed', z: 10 });
  return node('body', { rect: box(0, 0, 400, 800), kids: [results(70), backdrop, dialog] });
}

test('the pop-up\'s elements come first, the page behind it is marked blocked (a few of it only)', () => {
  for (const ariaModal of [false, true]) {
    const r = rig(google({ ariaModal }));
    const c = r.run('content');
    assert.deepEqual(c.overlay, { label: 'Before you continue to Google', kind: 'modal', frame: false });
    assert.deepEqual(c.elements.slice(0, 3).map((e) => [e.id, e.text, e.in_popup]), [['c1', 'Reject all', true],
      ['c2', 'Accept all', true], ['c3', 'More options', true]]);
    const behind = c.elements.slice(3);
    assert.ok(behind.length > 0 && behind.length <= 15);
    assert.ok(behind.every((e) => e.blocked === true && !e.in_popup));
    assert.match(c.text, /^Pop-up: Before you continue to Google .*\| Page behind it: /);
  }
});

test('a tap on a result behind the dialog is refused (no pointer, no tap); the dialog\'s buttons work', () => {
  const r = rig(google());
  r.run('content');
  assert.deepEqual(r.run('point', { id: 'c4', action: 'click' }), { error: 'covered',
    covered: 'Before you continue to Google' });
  assert.deepEqual(r.run('click', { id: 'c4' }), { error: 'covered', covered: 'Before you continue to Google' });
  assert.equal(r.run('inspect', { id: 'c4', action: 'click' }).error, 'covered');   // no approval asked for it
  assert.equal(r.all().some((e) => e.clicked), false);
  const p = r.run('point', { id: 'c1', action: 'click' });
  assert.equal(p.error, undefined);
  assert.equal(p.hit, true);
});

test('"Reject all" in the pop-up only declines (no approval); "Accept all" in its form still asks', () => {
  const r = rig(google());
  r.run('content');
  const reject = r.run('inspect', { id: 'c1', action: 'click' });
  assert.equal(reject.descriptor.in_popup, true);
  assert.equal(reject.risk, null);
  assert.equal(r.run('inspect', { id: 'c2', action: 'click' }).risk.kind, 'form_submission');
  // The server agrees (policy.js mirrors overlay.js), and outside a pop-up "Reject all" still asks.
  assert.equal(policy.approval({ name: 'click', args: { id: 'c1' } }, { elements: new Map([['c1',
    { ...reject.descriptor }]]) }), null);
  assert.equal(policy.approval({ name: 'click', args: { id: 'c1' } }, { elements: new Map([['c1',
    { ...reject.descriptor, in_popup: false }]]) }).kind, 'form_submission');
});

test('no pop-up: the snapshot is as before (document order, nothing marked)', () => {
  const r = rig(node('body', { rect: box(0, 0, 400, 800), kids: [results(5)] }));
  const c = r.run('content');
  assert.equal(c.overlay, null);
  assert.deepEqual(c.elements.map((e) => e.text), ['Result 1', 'Result 2', 'Result 3', 'Result 4', 'Result 5']);
  assert.ok(c.elements.every((e) => !e.in_popup && !e.blocked));
  assert.equal(r.run('point', { id: 'c2', action: 'click' }).hit, true);
  // An older app (no overlay.js) still works the 0.11.1 way.
  assert.equal(rig(google(), { noOverlay: true }).run('content').overlay, null);
});

test('a cookie banner at the bottom blocks only what it covers', () => {
  const top = node('button', { text: 'Search', rect: box(20, 100, 200, 40) });
  const under = node('button', { text: 'Load more', rect: box(20, 700, 200, 40) });
  const banner = node('div', { attrs: { 'aria-label': 'Cookie notice' }, rect: box(0, 620, 400, 180),
    position: 'fixed', z: 5, kids: [node('button', { text: 'Got it', rect: box(250, 740, 100, 40) })] });
  const r = rig(node('body', { rect: box(0, 0, 400, 800), kids: [top, under, banner] }));
  const c = r.run('content');
  assert.equal(c.overlay.kind, 'banner');
  assert.equal(c.overlay.label, 'Cookie notice');
  assert.deepEqual(c.elements.map((e) => [e.text, !!e.in_popup, !!e.blocked]), [['Got it', true, false],
    ['Search', false, false], ['Load more', false, true]]);
  assert.equal(r.run('point', { id: 'c2', action: 'click' }).hit, true);
  assert.equal(r.run('point', { id: 'c3', action: 'click' }).error, 'covered');
});

test('a consent frame (another site Saga cannot read inside) is reported as one', () => {
  const frame = node('iframe', { attrs: { src: 'https://consent.google.com/ml?continue=x', title: 'Consent' },
    rect: box(0, 150, 400, 600), position: 'fixed', z: 20 });
  const c = rig(node('body', { rect: box(0, 0, 400, 800), kids: [results(3), frame] })).run('content');
  assert.deepEqual(c.overlay, { label: 'Consent', kind: 'modal', frame: true });
  assert.ok(c.elements.every((e) => e.blocked));
});

test('a dialog that is not on screen (or not on top) is no pop-up', () => {
  const hidden = node('div', { attrs: { role: 'dialog' }, rect: box(0, 0, 0, 0), kids: [node('button',
    { text: 'Close', rect: box(0, 0, 0, 0) })] });
  const c = rig(node('body', { rect: box(0, 0, 400, 800), kids: [results(3), hidden] })).run('content');
  assert.equal(c.overlay, null);
});

test('a web app laid out in one full-screen fixed box is the page itself, not a pop-up', () => {
  const app = node('div', { attrs: { id: 'app' }, rect: box(0, 0, 400, 800), position: 'fixed', z: 1,
    kids: [results(6)] });
  const c = rig(node('body', { rect: box(0, 0, 400, 800), kids: [app] })).run('content');
  assert.equal(c.overlay, null);
  assert.ok(c.elements.every((e) => !e.in_popup && !e.blocked));
});
