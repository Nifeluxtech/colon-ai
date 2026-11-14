// Unit tests for apps/chat/src/lib/browser-opener.js and the 0.11.1 live-card placement (lib/saga-card.js liveSpot,
// layout's replaces) and chat resync (lib/native-panel.js needsChatResync). Owner's report on 0.11.0 (Infinix SMART
// 20): "Open browser" showed no card until they left the chat and came back, and then it sat at the bottom of the
// thread next to an old task's picture (a duplicate).
const test = require('node:test');
const assert = require('node:assert/strict');
const { KEY, MAX, openerStore } = require('../../../apps/chat/src/lib/browser-opener.js');
const { layout, liveSpot } = require('../../../apps/chat/src/lib/saga-card.js');
const { MAX_RESYNC, liveHere, needsChatResync } = require('../../../apps/chat/src/lib/native-panel.js');

function memStorage() {
  const m = {};
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
}

test('openerStore: kept per chat in storage, so it survives leaving the chat (and a reload)', () => {
  const ls = memStorage();
  const a = openerStore(ls);
  assert.equal(a.get('c1'), null);
  a.set('c1', 'm9', 1000);
  assert.deepEqual(a.get('c1'), { id: 'm9', at: 1000, seenAt: 0 });
  const b = openerStore(ls);                       // a new page (or the chat opened again)
  assert.deepEqual(b.get('c1'), { id: 'm9', at: 1000, seenAt: 0 });
  b.set('c1', 'm12', 2000);                        // a later "show the browser" moves it
  assert.equal(openerStore(ls).get('c1').id, 'm12');
  assert.equal(b.get('c2'), null);
  b.set('', 'x', 1); b.set('c3', '', 1);           // nothing without a chat or a message
  assert.equal(b.get('c3'), null);
});

test('openerStore: seenAt is set once (never "now" again) and cleared when the browser closes', () => {
  const s = openerStore(memStorage());
  s.seen('c1', 500); s.seen('c1', 900);
  assert.equal(s.get('c1').seenAt, 500);
  s.set('c1', 'm1', 700);
  assert.equal(s.get('c1').seenAt, 500);           // the opener keeps the first sighting
  s.unseen('c1');
  assert.equal(s.get('c1').seenAt, 0);
  s.seen('c1', 1200);
  assert.equal(s.get('c1').seenAt, 1200);
  s.forget('c1');
  assert.equal(s.get('c1'), null);
});

test('openerStore: bad or blocked storage never throws; at most MAX chats are kept', () => {
  const bad = { getItem: () => '{nope', setItem: () => { throw new Error('quota'); } };
  const s = openerStore(bad);
  s.set('c1', 'm1', 1);
  assert.equal(s.get('c1').id, 'm1');              // memory still works
  assert.doesNotThrow(() => openerStore(null).set('c', 'm', 1));
  const ls = memStorage(), many = openerStore(ls);
  for (let i = 0; i < MAX + 5; i++) many.set('c' + i, 'm' + i, 1000 + i);
  const kept = JSON.parse(ls.m[KEY]);
  assert.equal(Object.keys(kept).length, MAX);
  assert.ok(!('c0' in kept) && ('c' + (MAX + 4)) in kept); // the oldest went first
});

test('liveSpot: a running task keeps its message and hides its own picture', () => {
  const st = { run: { state: 'running', anchor: 'u5', task: '42', since: 3000 } };
  assert.deepEqual(liveSpot(st, { id: 'r1', at: 9000 }, 100), { anchor: 'u5', at: 3000, hide: '42' });
});

test('liveSpot: an idle browser goes under the reply that opened it when that came after the last task', () => {
  const st = { run: { state: 'done', anchor: 'u5', task: '42', since: 3000 } };
  assert.deepEqual(liveSpot(st, { id: 'r9', at: 5000 }, 100), { anchor: 'r9', at: 5000, hide: null });
  assert.deepEqual(liveSpot({ run: { state: 'idle' } }, { id: 'r1', at: 10 }, 0), { anchor: 'r1', at: 10, hide: null });
});

test('liveSpot: after a task ended, the live browser takes that task\'s place (never a second card)', () => {
  const st = { run: { state: 'done', anchor: 'u5', task: '42', since: 8000 } };
  assert.deepEqual(liveSpot(st, { id: 'r1', at: 5000 }, 100),
    { anchor: 'u5', at: 8000, hide: '42', replaces: true });
  assert.deepEqual(liveSpot(st, null, 0), { anchor: 'u5', at: 8000, hide: '42', replaces: true });
});

test('liveSpot: nothing known: the time this page first saw it open, never "now" (the card followed new messages)',
  () => {
    assert.deepEqual(liveSpot({ run: { state: 'idle', since: 0 } }, null, 4000),
      { anchor: null, at: 4000, hide: null });
    assert.deepEqual(liveSpot({}, null, 0), { anchor: null, at: 0, hide: null });
  });

test('layout with replaces: the newest run\'s picture under that message goes even when its id differs', () => {
  const msgs = [{ id: 'u5' }, { id: 'r5' }, { id: 'u6' }];
  const cards = [{ id: '6', anchor: 'u5', at: 5 }, { id: 'local-x', anchor: 'u6', at: 10 }];
  const g = layout(msgs, cards, { anchor: 'u6', at: 30, replaces: true }, '42');
  assert.deepEqual(g.map((x) => [x.after, x.items.map((i) => i.kind === 'live' ? 'live' : i.card.id)]),
    [['u5', ['6']], ['u6', ['live']]]);
  // 0.11.2: an older run's card is never erased, even when the live browser sits under its message.
  const old = layout(msgs, [...cards, { id: '7', anchor: 'u6', at: 20 }], { anchor: 'u5', at: 30, replaces: true },
    '42');
  assert.deepEqual(old.map((x) => [x.after, x.items.map((i) => i.kind === 'live' ? 'live' : i.card.id)]),
    [['u5', ['6', 'live']], ['u6', ['local-x', '7']]]);
  // Without replaces (the user opened it under a reply), the old task keeps its picture.
  const h = layout(msgs, cards, { anchor: 'r5', at: 30 }, null);
  assert.deepEqual(h.map((x) => [x.after, x.items.map((i) => i.kind === 'live' ? 'live' : i.card.id)]),
    [['u5', ['6']], ['u6', ['local-x']], ['r5', ['live']]]);
});

test('needsChatResync: the app names another chat: tell it again, at most MAX_RESYNC times, one at a time', () => {
  assert.equal(needsChatResync({ chat: 'c1' }, 'c2', {}), true);
  assert.equal(needsChatResync({ chat: null }, 'c2', {}), true);      // still the new chat's draft
  assert.equal(needsChatResync({ chat: 'c1' }, null, {}), true);      // a new chat on screen
  assert.equal(needsChatResync({ chat: 'c2' }, 'c2', {}), false);
  assert.equal(needsChatResync({ chat: null }, null, {}), false);
  assert.equal(needsChatResync({ chat: 'c1' }, 'c2', { pending: true }), false);
  assert.equal(needsChatResync({ chat: 'c1' }, 'c2', { tries: MAX_RESYNC }), false);
  assert.equal(needsChatResync({ open: true }, 'c2', {}), false);     // an app before 0.10.3 (no "chat")
  assert.equal(needsChatResync(null, 'c2', {}), false);
  assert.equal(needsChatResync({ chat: 'c1', run: { state: 'running' } }, 'c2', {}), false); // a scheduled run there
  // Once resynced, the card shows: liveHere agrees.
  assert.equal(liveHere({ chat: 'c2', run: {} }, { chat: 'c2', messages: 2 }), true);
});
