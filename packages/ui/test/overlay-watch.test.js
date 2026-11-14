// 0.11.0: the app's browser card hides under the chat's overlays (apps/chat/src/lib/overlay-watch.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { anyOverlay, createOverlayWatch } = require('../../../apps/chat/src/lib/overlay-watch.js');

function fakeDoc() {
  const open = new Set();
  return { open, body: {}, querySelectorAll: (sel) => (open.has(sel)
    ? [{ hidden: false, getBoundingClientRect: () => ({ width: 10, height: 10 }) }] : []) };
}
function root() {
  const cls = new Set();
  return { cls, classList: { contains: (c) => cls.has(c) }, querySelector: () => null };
}

test('any overlay kind counts: drawer class, sheets, menus, dialogs; zero-size elements do not', () => {
  const d = fakeDoc(), r = root();
  assert.equal(anyOverlay(d, r), false);
  r.cls.add('drawer-open'); assert.equal(anyOverlay(d, r), true); r.cls.clear();
  d.open.add('.menu'); assert.equal(anyOverlay(d, r), true);
  const zero = { body: {}, querySelectorAll: () => [{ getBoundingClientRect: () => ({ width: 0, height: 0 }) }] };
  assert.equal(anyOverlay(zero, null), false);
});

test('reports changes only, once per frame, and un-suspends on stop', () => {
  const d = fakeDoc(), r = root(), frames = [], seen = [];
  let observer = null;
  function MO(cb) { observer = { cb, n: 0 }; this.observe = () => { observer.n++; }; this.disconnect = () => {
    observer.off = true; }; }
  const w = createOverlayWatch({ doc: d, root: r, MutationObserver: MO, raf: (f) => frames.push(f),
    onChange: (o) => seen.push(o) });
  assert.equal(observer.n, 2);
  frames.splice(0).forEach((f) => f()); assert.deepEqual(seen, []);
  d.open.add('.sheet'); observer.cb(); observer.cb(); assert.equal(frames.length, 1);
  frames.splice(0).forEach((f) => f()); assert.deepEqual(seen, [true]); assert.equal(w.open(), true);
  observer.cb(); frames.splice(0).forEach((f) => f()); assert.deepEqual(seen, [true]);
  w.stop(); assert.deepEqual(seen, [true, false]); assert.ok(observer.off);
  w.check(); assert.equal(frames.length, 0);
});
