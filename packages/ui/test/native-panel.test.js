// Unit tests for apps/chat/src/lib/native-panel.js (v0.9.2): the chat page's side of the "this page draws the
// inline card" handshake with the Android app, and a small model of the app's side (ChatBrowserPanel's webInline,
// grace and inlineReady) to check every open path ends in the thread on a phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { needsAnnounce, showsCard, withInline } = require('../../../apps/chat/src/lib/native-panel.js');

test('withInline adds inline: true only when the app can show the panel in the thread', () => {
  assert.deepEqual(withInline({ url: 'https://a.ng' }, true), { inline: true, url: 'https://a.ng' });
  assert.deepEqual(withInline(undefined, true), { inline: true });
  assert.deepEqual(withInline({ url: 'x' }, false), { url: 'x' });
  assert.deepEqual(withInline(undefined, false), {});
});

test('needsAnnounce: a 0.9.2 app that has not heard from the page yet', () => {
  const base = { open: true, layout: 'embedded' };
  assert.equal(needsAnnounce(Object.assign({ inlineReady: false }, base), { canInline: true }), true);
  assert.equal(needsAnnounce({ open: true, layout: 'inline', inlineReady: null }, { canInline: true }), true);
  // closed panels too: the next open the app makes by itself then starts in the thread
  assert.equal(needsAnnounce({ open: false, layout: 'inline', inlineReady: false }, { canInline: true }), true);
  assert.equal(needsAnnounce({ open: true, layout: 'inline', inlineReady: true }, { canInline: true }), false);
  assert.equal(needsAnnounce(Object.assign({ inlineReady: false }, base), { canInline: true, pending: true }), false);
  assert.equal(needsAnnounce(Object.assign({ inlineReady: false }, base), { canInline: false }), false);
  assert.equal(needsAnnounce(null, { canInline: true }), false);
  assert.equal(needsAnnounce('x', { canInline: true }), false);
});

test('needsAnnounce: a 0.9.1 app (no inlineReady) showing embedded is told once per page', () => {
  const st = { open: true, layout: 'embedded' };
  assert.equal(needsAnnounce(st, { canInline: true }), true);
  assert.equal(needsAnnounce(st, { canInline: true, announced: true }), false);
  assert.equal(needsAnnounce({ open: true, layout: 'split' }, { canInline: true }), false); // a choice, left alone
  assert.equal(needsAnnounce({ open: false, layout: 'embedded' }, { canInline: true }), false);
});

test('showsCard: only an open panel in the inline layout, in an app that has it', () => {
  assert.equal(showsCard({ open: true, layout: 'inline' }, true), true);
  assert.equal(showsCard({ open: true, layout: 'inline' }, false), false);
  assert.equal(showsCard({ open: false, layout: 'inline' }, true), false);
  assert.equal(showsCard({ open: true, layout: 'embedded' }, true), false);
  assert.equal(showsCard(null, true), false);
});

/* ---- A model of the app (ChatBrowserPanel 0.9.2 on a phone) and the page, wired like the bridge ---- */
function app() {
  const a = { webInline: null, open: false, mode: 'inline', saved: 'embedded', events: [], graceArmed: false };
  a.effective = () => (a.mode === 'inline' && a.webInline === false ? 'embedded' : a.mode);
  a.state = () => ({ open: a.open, layout: a.effective(), inlineReady: a.webInline === true });
  a.emit = () => a.events.push(a.state());
  a.arm = () => { if (a.webInline === null) a.graceArmed = true; };
  a.grace = () => { if (a.graceArmed && a.webInline === null) a.webInline = false; a.graceArmed = false; a.emit(); };
  a.openPanel = () => { if (!a.open) a.mode = 'inline'; a.open = true; a.arm(); a.emit(); }; // phones: openMode
  a.pageStarted = () => { a.webInline = null; a.graceArmed = false; if (a.open) a.arm(); };
  a.call = (args) => { if (args.inline || args.action === 'anchor') { a.webInline = true; a.graceArmed = false; }
    if (args.action === 'open') a.openPanel(); return a.state(); };
  return a;
}
function page(a) {
  const p = { announced: false, card: false };
  p.sync = (st) => {
    p.card = showsCard(st, true);
    if (needsAnnounce(st, { canInline: true, announced: p.announced })) {
      p.announced = true; p.sync(a.call(withInline({ action: 'state' }, true)));
    }
  };
  p.deliver = () => { a.events.splice(0).forEach(p.sync); };
  return p;
}

test('Saga or a routed link opens the panel before the page said anything: it ends in the thread', () => {
  const a = app(), p = page(a);
  a.openPanel();                       // the app opens by itself (Saga's control request, a link)
  assert.equal(a.effective(), 'inline'); // unknown is inline (hidden until the card reports), not embedded
  p.deliver();
  assert.equal(a.webInline, true);
  assert.equal(p.card, true);
});

test('the grace ran out (slow reload on a cheap phone): the page puts the panel back in the thread', () => {
  const a = app(), p = page(a);
  a.call(withInline({ action: 'open' }, true)); p.deliver();
  a.pageStarted();                     // the chat page reloads while the panel is open
  a.grace();                           // ...and takes longer than the app waits
  assert.equal(a.effective(), 'embedded');
  const p2 = page(a); p2.deliver();     // the new page gets the state (inlineReady false) and says it draws the card
  assert.equal(a.effective(), 'inline');
  assert.equal(p2.card, true);
  assert.equal(p.card, true);
});

test('Browser button, AI Browse and reopen after close all open in the thread', () => {
  const a = app(), p = page(a);
  for (const action of ['open', 'open']) {
    p.sync(a.call(withInline({ action }, true)));
    assert.equal(a.effective(), 'inline'); assert.equal(p.card, true);
    a.open = false; a.mode = 'full';   // closed while full screen: the next open still starts in the thread
  }
});
