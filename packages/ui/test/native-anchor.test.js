// Unit tests for apps/chat/src/lib/native-anchor.js (v0.9.1): where the Android app's inline browser panel sits in
// the thread. Rect math and visibility, one report per animation frame, nothing sent when nothing moved, and the
// keyboard (visualViewport) and stop() handled. A fake DOM: elements with a settable client rect and listeners.
const test = require('node:test');
const assert = require('node:assert/strict');
const { anchorRect, coverTop, createAnchor, screenOf, viewOf } = require('../../../apps/chat/src/lib/native-anchor.js');

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
    viewportBottom: 696, dpr: 2.625, pageHeight: 800 }]);
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

// v0.10.1: the thread scrolls under the floating composer, so the band ends at the composer's top; the app's WebView
// is clipped there and never covers the message box or its "Synced" line.
test('the band ends at the floating composer (cover), not at the scroller bottom under it', () => {
  const s = el({ left: 0, top: 56, width: 400, height: 744 });            // runs to the screen's bottom (800)
  const composer = el({ left: 0, top: 668, width: 400, height: 132 });
  assert.deepEqual(viewOf(s, { innerHeight: 800 }, composer), { top: 56, bottom: 668 });
  composer.hidden = true;                                                  // pages: no composer, nothing cut
  assert.deepEqual(viewOf(s, { innerHeight: 800 }, composer), { top: 56, bottom: 800 });
  const gone = el({ left: 0, top: 0, width: 0, height: 0 });
  assert.deepEqual(viewOf(s, { innerHeight: 800 }, gone), { top: 56, bottom: 800 });
  // keyboard open: the composer moved up with the visual viewport and still cuts the band
  const up = el({ left: 0, top: 300, width: 400, height: 120 });
  assert.deepEqual(viewOf(s, { innerHeight: 800, visualViewport: { height: 420, offsetTop: 0 } }, up),
    { top: 56, bottom: 300 });
});

test('createAnchor with cover: viewportBottom is the composer top, and the composer is observed', () => {
  const frames = [], sent = [], observed = [];
  const win = Object.assign(target(), { innerHeight: 800, devicePixelRatio: 2, visualViewport: null,
    ResizeObserver: class { observe(e) { observed.push(e); } disconnect() {} } });
  const scroller = el({ left: 0, top: 56, width: 400, height: 744 });
  const cover = el({ left: 0, top: 668, width: 400, height: 132 });
  const body = el({ left: 10, top: 400, width: 380, height: 480 });        // runs under the composer
  const a = createAnchor({ el: body, scroller, cover, win, send: (p) => sent.push(p),
    raf: (f) => { frames.push(f); return frames.length; }, caf: () => {} });
  frames.splice(0).forEach((f) => f());
  assert.equal(sent[0].visible, true);
  assert.equal(sent[0].viewportTop, 56); assert.equal(sent[0].viewportBottom, 668);
  assert.ok(observed.includes(cover));
  cover.rect = { left: 0, top: 620, width: 400, height: 180 };              // composer grew (attachments)
  a.update(); frames.splice(0).forEach((f) => f());
  assert.equal(sent[1].viewportBottom, 620);
  body.rect = { left: 10, top: 640, width: 380, height: 480 };              // card now entirely behind the composer
  a.update(); frames.splice(0).forEach((f) => f());
  assert.deepEqual(sent[2], { visible: false });
});

// 0.10.2: the owner's phone still showed the panel over the composer while scrolling. The numbers are now measured
// from the visual viewport's corner (what the app's WebView shows) and carry pageHeight, so the app keeps the
// composer's gap even when its WebView resized (the keyboard) before the page's next report.
test('screen: numbers relative to the visual viewport, pageHeight, and the pinch scale in dpr', () => {
  const box = { left: 16, top: 400, width: 368, height: 300 };
  const p = anchorRect(box, { top: 100, bottom: 700 }, 2, false, { x: 0, y: 60, height: 640, scale: 1 });
  assert.deepEqual(p, { visible: true, x: 16, y: 340, width: 368, height: 300, viewportTop: 40, viewportBottom: 640,
    dpr: 2, pageHeight: 640 });
  assert.equal(anchorRect(box, { top: 100, bottom: 700 }, 2, false, { x: 0, y: 0, height: 800, scale: 1.5 }).dpr, 3);
  assert.deepEqual(screenOf({ innerHeight: 800, visualViewport: { offsetLeft: 0, offsetTop: 12, height: 500,
    scale: 1 } }), { x: 0, y: 12, height: 500, scale: 1 });
  assert.deepEqual(screenOf({ innerHeight: 800, visualViewport: null }), { x: 0, y: 0, height: 800, scale: 1 });
});

test('cover: looked up on every measure, and the "Latest" button above the composer cuts the band too', () => {
  const composer = el({ left: 0, top: 668, width: 400, height: 132 });
  assert.equal(coverTop(() => composer), 668);
  assert.equal(coverTop(() => null), Infinity);
  const jump = el({ left: 150, top: 620, width: 100, height: 36 });
  composer.querySelector = (sel) => (sel === '.cw-jump:not([hidden])' ? jump : null);
  assert.equal(coverTop(composer), 620);
  composer.querySelector = () => null;                                     // hidden again
  assert.equal(coverTop(composer), 668);
  let current = composer;                                                  // the composer is re-drawn
  const frames = [], sent = [];
  const win = Object.assign(target(), { innerHeight: 800, devicePixelRatio: 2, visualViewport: null });
  createAnchor({ el: el({ left: 0, top: 300, width: 400, height: 480 }), scroller: el({ left: 0, top: 56,
    width: 400, height: 744 }), cover: () => current, win, send: (p) => sent.push(p), raf: (f) => frames.push(f) });
  frames.splice(0).forEach((f) => f());
  assert.equal(sent[0].viewportBottom, 668);
  current = el({ left: 0, top: 600, width: 400, height: 200 });            // taller (two lines, attachments)
  win.fire('resize'); frames.splice(0).forEach((f) => f());
  assert.equal(sent[1].viewportBottom, 600);
});
