// Unit tests for apps/chat/src/lib/native-anchor.js (v0.9.1): where the Android app's inline browser panel sits in
// the thread. Rect math and visibility, one report per animation frame, nothing sent when nothing moved, and the
// keyboard (visualViewport) and stop() handled. A fake DOM: elements with a settable client rect and listeners.
const test = require('node:test');
const assert = require('node:assert/strict');
const { anchorRect, createAnchor, viewOf } = require('../../../apps/chat/src/lib/native-anchor.js');

function target() {
  const ls = {};
  return { ls, addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); },
    fire(t) { (ls[t] || []).slice().forEach((f) => f()); }, count(t) { return (ls[t] || []).length; } };
}
function el(rect) { const e = target(); e.rect = rect; e.isConnected = true;
  e.getBoundingClientRect = () => { const r = e.rect; return { left: r.left, top: r.top, width: r.width,
    height: r.height, right: r.left + r.width, bottom: r.top + r.height }; }; return e; }

function rig(o = {}) {
  const frames = [], sent = [], observed = [];
  const win = Object.assign(target(), { innerHeight: 800, devicePixelRatio: 2.625, visualViewport: null });
  if (o.vv) win.visualViewport = Object.assign(target(), { height: o.vv, offsetTop: 0 });
  win.ResizeObserver = class { constructor(cb) { this.cb = cb; rig.lastRo = this; }
    observe(e) { observed.push(e); } disconnect() { this.off = true; } };
  const scroller = el({ left: 0, top: 56, width: 400, height: 640 });  // header above, composer below
  const body = el({ left: 16, top: 300, width: 368, height: 480 });
  let collapsed = false;
  const a = createAnchor({ el: body, scroller, watch: [{ page: 1 }], win, send: (p) => sent.push(p),
    collapsed: () => collapsed, raf: (f) => { frames.push(f); return frames.length; },
    caf: () => { frames.length = 0; } });
  const flush = () => { const fs = frames.splice(0); fs.forEach((f) => f()); };
  return { a, win, scroller, body, sent, frames, flush, observed, setCollapsed: (c) => { collapsed = c; } };
}

test('rect math: CSS px of the body box, the thread viewport and the device pixel ratio', () => {
  const p = anchorRect({ left: 16, top: 300.333, width: 368, height: 480 }, { top: 56, bottom: 696 }, 2.625);
  assert.deepEqual(p, { visible: true, x: 16, y: 300.33, width: 368, height: 480, viewportTop: 56,
    viewportBottom: 696, dpr: 2.625 });
  assert.equal(anchorRect({ left: 0, top: 0, width: 10, height: 10 }, { top: 0, bottom: 100 }, 0).dpr, 1);
});

test('visibility: off screen above or below the thread, collapsed, or empty boxes are hidden', () => {
  const view = { top: 56, bottom: 696 };
  assert.deepEqual(anchorRect({ left: 0, top: -500, width: 300, height: 556 }, view, 2), { visible: false });
  assert.deepEqual(anchorRect({ left: 0, top: 696, width: 300, height: 400 }, view, 2), { visible: false });
  assert.equal(anchorRect({ left: 0, top: -499, width: 300, height: 556 }, view, 2).visible, true); // 1px shows
  assert.deepEqual(anchorRect({ left: 0, top: 100, width: 300, height: 400 }, view, 2, true), { visible: false });
  assert.deepEqual(anchorRect({ left: 0, top: 100, width: 0, height: 0 }, view, 2), { visible: false });
  assert.deepEqual(anchorRect({ left: 0, top: 100, width: 300, height: 400 }, { top: 50, bottom: 50 }, 2),
    { visible: false });
});

test('the thread viewport is cut by the window and the keyboard (visualViewport)', () => {
  const s = el({ left: 0, top: -10, width: 400, height: 900 });
  assert.deepEqual(viewOf(s, { innerHeight: 800 }), { top: 0, bottom: 800 });
  assert.deepEqual(viewOf(s, { innerHeight: 800, visualViewport: { height: 420, offsetTop: 0 } }),
    { top: 0, bottom: 420 });
});

test('reports on open, then at most once per frame and only when something moved', () => {
  const r = rig();
  assert.equal(r.sent.length, 0); assert.equal(r.frames.length, 1);  // first report waits for a frame
  r.flush();
  assert.deepEqual(r.sent, [{ visible: true, x: 16, y: 300, width: 368, height: 480, viewportTop: 56,
    viewportBottom: 696, dpr: 2.625 }]);
  for (let i = 0; i < 5; i++) r.scroller.fire('scroll');           // a burst of scroll events: one frame
  assert.equal(r.frames.length, 1);
  r.body.rect = { left: 16, top: 200, width: 368, height: 480 }; r.flush();
  assert.equal(r.sent.length, 2); assert.equal(r.sent[1].y, 200);
  r.scroller.fire('scroll'); r.flush();                            // nothing moved: nothing sent
  assert.equal(r.sent.length, 2);
  r.win.fire('resize'); r.body.rect = { left: 10, top: 200, width: 380, height: 480 }; r.flush();
  assert.equal(r.sent[2].width, 380);
  assert.ok(r.observed.includes(r.body) && r.observed.includes(r.scroller) && r.observed.length === 3);
  rig.lastRo.cb(); assert.equal(r.frames.length, 1);              // ResizeObserver schedules a frame too
});

test('scrolled out of view or collapsed sends one { visible: false }', () => {
  const r = rig(); r.flush();
  r.body.rect = { left: 16, top: -600, width: 368, height: 480 }; r.scroller.fire('scroll'); r.flush();
  assert.deepEqual(r.sent[1], { visible: false });
  r.body.rect = { left: 16, top: -700, width: 368, height: 480 }; r.scroller.fire('scroll'); r.flush();
  assert.equal(r.sent.length, 2);                                  // still hidden: not repeated
  r.body.rect = { left: 16, top: 300, width: 368, height: 480 }; r.a.update(); r.flush();
  assert.equal(r.sent[2].visible, true);
  r.setCollapsed(true); r.a.update(); r.flush();
  assert.deepEqual(r.sent[3], { visible: false });
  r.body.isConnected = false; r.setCollapsed(false); r.a.update(); r.flush();
  assert.equal(r.sent.length, 4);                                  // detached box: hidden, already said
});

test('the keyboard shrinks the viewport through visualViewport events', () => {
  const r = rig({ vv: 800 }); r.flush();
  assert.equal(r.sent[0].viewportBottom, 696);
  r.win.visualViewport.height = 380; r.win.visualViewport.fire('resize'); r.flush();
  assert.equal(r.sent[1].viewportBottom, 380);
});

test('stop() removes every listener, cancels the frame and hides the panel once', () => {
  const r = rig({ vv: 800 }); r.flush();
  r.scroller.fire('scroll');
  r.a.stop();
  assert.equal(r.frames.length, 0);
  assert.deepEqual(r.sent[r.sent.length - 1], { visible: false });
  assert.equal(r.scroller.count('scroll') + r.win.count('resize') + r.win.visualViewport.count('resize'), 0);
  assert.ok(rig.lastRo.off);
  const n = r.sent.length; r.a.stop(); r.a.update(); r.flush();
  assert.equal(r.sent.length, n);
});

test('a keyboard opening (visual viewport loses > 120 px) is reported once; small changes are not', () => {
  let kb = 0;
  const frames = [], sent = [];
  const win = Object.assign(target(), { innerHeight: 800, devicePixelRatio: 2, ResizeObserver: undefined,
    visualViewport: Object.assign(target(), { height: 800, offsetTop: 0 }) });
  createAnchor({ el: el({ left: 0, top: 100, width: 300, height: 300 }), scroller: el({ left: 0, top: 0,
    width: 300, height: 800 }), win, send: (p) => sent.push(p), onKeyboard: () => kb++, raf: (f) => frames.push(f) });
  win.visualViewport.height = 760; win.visualViewport.fire('resize'); assert.equal(kb, 0);
  win.visualViewport.height = 400; win.visualViewport.fire('resize'); assert.equal(kb, 1);
  win.visualViewport.height = 800; win.visualViewport.fire('resize'); assert.equal(kb, 1);  // closing: no
  assert.equal(frames.length, 1);                                                               // one frame queued
});
