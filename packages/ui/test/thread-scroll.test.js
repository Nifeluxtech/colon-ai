// Unit tests for apps/chat/src/lib/thread-scroll.js (v0.10.1): only the message thread scrolls. The browser card is
// revealed by moving #cw-scroll alone (never the window or the fixed frame, as scrollIntoView did), into the band
// between the header and the floating composer; pinFrame puts the frame and the window back at 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pinFrame, reveal, revealTop } = require('../../../apps/chat/src/lib/thread-scroll.js');

function target() {
  const ls = {};
  return { ls, addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); },
    fire(t) { (ls[t] || []).slice().forEach((f) => f()); }, count(t) { return (ls[t] || []).length; } };
}
function rectOf(r) { return { left: r.left || 0, top: r.top, width: r.width || 400, height: r.height,
  right: (r.left || 0) + (r.width || 400), bottom: r.top + r.height }; }

// A thread whose content moves with scrollTop: el's rect is its offset in the content minus scrollTop.
function rig(o = {}) {
  const calls = [];
  const win = Object.assign(target(), { innerHeight: 800, visualViewport: o.vv || null, scrollY: 0, scrollX: 0,
    scrollTo(x, y) { calls.push(['window', x, y]); this.scrollX = x; this.scrollY = y; } });
  const scroller = { scrollTop: o.top || 0, scrollHeight: 3000, clientHeight: 744,
    getBoundingClientRect: () => rectOf({ top: 56, height: 744 }),
    scrollTo(opt) { calls.push(['thread', opt]); this.scrollTop = opt.top; } };
  const cover = { getBoundingClientRect: () => rectOf({ top: o.coverTop || 668, height: 132 }) };
  const card = (offset, height) => ({ getBoundingClientRect: () => rectOf({ top: 56 + offset - scroller.scrollTop,
    height }) });
  return { win, scroller, cover, card, calls };
}

test('revealTop: nearest, taller-than-band shows its top, clamped to the scroll range', () => {
  const band = { top: 56, bottom: 668 };
  assert.equal(revealTop(100, { top: 200, bottom: 400 }, band, 2000), 100);       // already fits: no move
  assert.equal(revealTop(100, { top: 500, bottom: 800 }, band, 2000), 232);       // below: bottom to composer top
  assert.equal(revealTop(100, { top: 10, bottom: 210 }, band, 2000), 54);         // above: top to header
  assert.equal(revealTop(100, { top: 300, bottom: 1000 }, band, 2000), 344);      // taller: its top at the header
  assert.equal(revealTop(1900, { top: 600, bottom: 900 }, band, 2000), 2000);     // clamped to max
  assert.equal(revealTop(10, { top: 0, bottom: 20 }, band, 2000), 0);             // never negative
  assert.equal(revealTop(10, { top: 0, bottom: 20 }, { top: 5, bottom: 5 }, 2000), 10);
});

test('reveal scrolls the thread only, to the band above the composer, never the window', () => {
  const r = rig({ top: 0 });
  const box = r.card(1200, 412);                                   // the native card, far below
  const at = reveal(r.scroller, box, { cover: r.cover, win: r.win });
  assert.equal(at, 1200 + 412 - (668 - 56));                       // its bottom sits on the composer's top
  assert.equal(r.scroller.scrollTop, at);
  assert.equal(r.calls.filter((c) => c[0] === 'window').length, 0);
  assert.equal(r.win.scrollY, 0);
  const b = box.getBoundingClientRect();
  assert.ok(b.bottom <= 668 && b.top >= 56, 'card between the header and the composer');
  assert.equal(reveal(r.scroller, box, { cover: r.cover, win: r.win }), null);   // already in view: nothing moves
});

test('reveal: a card taller than the band (60vh card, keyboard open) shows its top under the header', () => {
  const r = rig({ top: 0, vv: { height: 420, offsetTop: 0 }, coverTop: 300 });
  const box = r.card(900, 480);
  reveal(r.scroller, box, { cover: r.cover, win: r.win, smooth: true });
  assert.deepEqual(r.calls, [['thread', { top: 900, behavior: 'smooth' }]]);
  assert.equal(box.getBoundingClientRect().top, 56);
});

test('reveal ignores missing elements', () => {
  const r = rig();
  assert.equal(reveal(null, r.card(0, 10), { win: r.win }), null);
  assert.equal(reveal(r.scroller, null, { win: r.win }), null);
});

test('pinFrame puts the window and the fixed frame back at 0, and stop() lets go', () => {
  const r = rig();
  const frame = Object.assign(target(), { scrollTop: 0, scrollLeft: 0 });
  r.win.scrollY = 40;                                               // already moved before mount
  const stop = pinFrame(r.win, frame);
  assert.equal(r.win.scrollY, 0);
  frame.scrollTop = 120; frame.fire('scroll');                      // e.g. an old scrollIntoView moved .cw
  assert.equal(frame.scrollTop, 0);
  r.win.scrollY = 75; r.win.fire('scroll');
  assert.equal(r.win.scrollY, 0);
  const n = r.calls.length; r.win.fire('scroll');                   // at 0 already: no extra scrollTo
  assert.equal(r.calls.length, n);
  stop();
  assert.equal(r.win.count('scroll'), 0); assert.equal(frame.count('scroll'), 0);
  frame.scrollTop = 9; frame.fire('scroll'); assert.equal(frame.scrollTop, 9);
});

test('the chat reveals cards through the thread, never with scrollIntoView (it scrolls the window too)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = (f) => fs.readFileSync(path.join(__dirname, '../../../apps/chat/src', f), 'utf8');
  const panel = src('components/browser-panel.js');
  assert.ok(!/\.scrollIntoView\(/.test(panel), 'browser-panel.js must use reveal(), not scrollIntoView');
  assert.ok(/cover: \$\('\.cw-composer'\)/.test(panel), 'the anchor is clipped above the composer');
  assert.ok(/pinFrame\(window, S\.el\)/.test(src('pages/chat.js')), 'the chat pins its frame');
});
