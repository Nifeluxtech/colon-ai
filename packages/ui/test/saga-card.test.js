// Unit tests for apps/chat/src/lib/saga-card.js (0.10.3, ADR 0006): the in-chat browser card's size, where each
// Saga task's card sits in the thread, its pill, the web's graceful card, and when a composer message is the
// user's hand-back to Saga.
const test = require('node:test');
const assert = require('node:assert/strict');
const card = require('../../../apps/chat/src/lib/saga-card.js');
const { bandOf, createAnchor } = require('../../../apps/chat/src/lib/native-anchor.js');

test('cardHeight: 16:10 at the card\'s width, capped to the visible thread, never a sliver', () => {
  assert.equal(card.cardHeight(340, 600), 213);            // a phone: 340 px wide -> 212.5 -> 213
  assert.equal(card.cardHeight(800, 400), 376);            // a tablet with little room: the band (minus margin)
  assert.equal(card.cardHeight(340, 100), card.MIN_HEIGHT); // keyboard open: never below the minimum
  assert.equal(card.cardHeight(340), 213);                 // no band known: the ratio alone
  assert.equal(card.cardHeight(0, 500), card.MIN_HEIGHT);
});

test('anchorFor: the asking message; else the last message at or before the task; else the end', () => {
  const msgs = [{ id: 'm1', created_at: '2026-11-14T10:00:00Z' }, { id: 'm2', created_at: '2026-11-14T10:05:00Z' },
    { id: 'm3', created_at: '2026-11-14T10:09:00Z' }];
  assert.equal(card.anchorFor(msgs, { anchor: 'm2' }), 'm2');
  assert.equal(card.anchorFor(msgs, { anchor: 'gone', at: Date.parse('2026-11-14T10:06:00Z') }), 'm2');
  assert.equal(card.anchorFor(msgs, { at: Date.parse('2026-11-14T09:00:00Z') }), null);
  assert.equal(card.anchorFor(msgs, { anchor: 'gone' }), null);
  assert.equal(card.anchorFor([], null), null);
});

test('layout: finished cards in time order under their messages, the live card last, its own old card hidden', () => {
  const msgs = [{ id: 'a' }, { id: 'b' }];
  const cards = [{ id: '7', anchor: 'b', at: 30 }, { id: '5', anchor: 'a', at: 10 }, { id: '6', anchor: 'b', at: 20 },
    { id: '9', anchor: 'b', at: 40 }];
  const g = card.layout(msgs, cards, { anchor: 'b', at: 50 }, '9');
  assert.deepEqual(g.map((x) => [x.after, x.items.map((i) => i.kind + (i.card.id || ''))]),
    [['a', ['snap5']], ['b', ['snap6', 'snap7', 'live']]]);
  // No anchor known: the end of the thread ('').
  assert.deepEqual(card.layout(msgs, [], { anchor: null, at: 1 }).map((x) => x.after), ['']);
  assert.deepEqual(card.layout(msgs, null, null), []);
});

test('the composer gives the browser back only while the user holds it for Saga', () => {
  assert.equal(card.givesBack({ state: 'needs_user' }), true);
  assert.equal(card.givesBack({ state: 'user_control', resumes: true }), true);
  assert.equal(card.givesBack({ state: 'user_control', resumes: false }), false);
  assert.equal(card.holdsIdle({ state: 'user_control', resumes: false }), true);
  assert.equal(card.givesBack({ state: 'running' }), false);
  assert.equal(card.givesBack(null), false);
});

test('snapPill and webCard: the result, or what stopped it; the web says where the live browser is', () => {
  assert.deepEqual(card.snapPill({ state: 'done', result: 'Deployed Colon AI v0.10.2' }),
    { icon: 'check', text: 'Deployed Colon AI v0.10.2' });
  assert.deepEqual(card.snapPill({ state: 'stopped' }), { icon: 'error', text: 'Saga stopped' });
  assert.equal(card.snapPill({ state: 'error' }).icon, 'error');
  const w = card.webCard({ id: 4, status: 'handoff', goal: 'Pay my bill', created_at: '2026-11-14T10:00:00Z' });
  assert.deepEqual([w.state, w.result, w.web, w.at > 0], ['running', 'Saga needs you in the Colon AI app', true, true]);
  assert.deepEqual([card.webCard({ id: 5, status: 'done' }, 'Paid ₦5,000').result, card.webCard({ id: 6,
    status: 'failed' }).state], ['Paid ₦5,000', 'error']);
});

test('endOf: what the chat tells the app when it sees the task end', () => {
  assert.deepEqual(card.endOf({ status: 'done' }, 'Booked a table'), { kind: 'done', result: 'Booked a table' });
  assert.deepEqual(card.endOf({ status: 'interrupted', error: 'stop' }), { kind: 'stopped', result: '' });
  assert.deepEqual(card.endOf({ status: 'timeout' }), { kind: 'error', result: '' });
});

test('native-anchor band: a hidden report still says where the composer is, when asked to', () => {
  assert.deepEqual(bandOf({ top: 56, bottom: 600 }, 2, { y: 0, height: 760, scale: 1 }),
    { viewportTop: 56, viewportBottom: 600, pageHeight: 760, dpr: 2 });
  assert.deepEqual(bandOf(null, 2, { height: 1 }), {});
  const sent = [];
  const win = { devicePixelRatio: 2, innerHeight: 760, addEventListener() {}, removeEventListener() {},
    visualViewport: null, requestAnimationFrame: (f) => { f(); return 1; } };
  const scroller = { getBoundingClientRect: () => ({ top: 56, bottom: 760 }), addEventListener() {},
    removeEventListener() {} };
  const el = { isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 2000, width: 340, height: 212 }) };
  const cover = { getBoundingClientRect: () => ({ top: 640, height: 120 }) };
  createAnchor({ el, scroller, cover, win, band: true, send: (p) => sent.push(p) });
  assert.deepEqual(sent[0], { visible: false, viewportTop: 56, viewportBottom: 640, pageHeight: 760, dpr: 2 });
});
