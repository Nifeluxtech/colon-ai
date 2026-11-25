// Colon JetX's round collector (v0.35.0, Crash Predictor step 3): the pure parts of the script the Android app
// injects into the game pane (apps/android/app/src/colonjetx/assets/jetx/collector.js). It must only pick
// multiplier-shaped text out of a history strip, send nothing on its first look, and send each new round once.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const FILE = path.resolve(__dirname, '../../../../apps/android/app/src/colonjetx/assets/jetx/collector.js');
const C = require(FILE);
const strip = (...ms) => ms.map((m) => ({ m, id: null }));
const items = (...texts) => texts.map((text) => ({ text }));

test('parseMultiplier: "1.53x" style text only', () => {
  const ok = [['1.53x', 1.53], [' 2.00 x ', 2], ['12,5x', 12.5], ['1X', 1], ['3.4×', 3.4], ['1000000.00x', 1e6]];
  for (const [t, want] of ok) assert.equal(C.parseMultiplier(t), want, t);
  for (const t of ['1.53', 'x1.53', '0.99x', '1.234x', '₦1.50x', 'Bet 2x', '', null, '1.5xx', '12345678x']) {
    assert.equal(C.parseMultiplier(t), null, String(t));
  }
});

test('readStrip: 5+ items, every one a multiplier; anything else is not the history strip', () => {
  assert.deepEqual(C.readStrip(items('1.53x', '2.10x', '1.00x', '7.77x', '1.2x')).map((x) => x.m),
    [1.53, 2.1, 1, 7.77, 1.2]);
  assert.equal(C.readStrip(items('1.5x', '2x', '5x', '10x')), null, 'four quick-pick buttons are not a strip');
  assert.equal(C.readStrip(items('1.53x', '2.10x', 'Balance 500', '7.77x', '1.2x')), null);
  assert.equal(C.readStrip(null), null);
});

test('roundIdOf: a safe id from the item’s data attributes only', () => {
  const attrs = (o) => (a) => (a in o ? o[a] : null);
  assert.equal(C.roundIdOf(attrs({ 'data-round-id': ' 8812345 ' })), '8812345');
  assert.equal(C.roundIdOf(attrs({ 'data-game-id': 'g_1:2' })), 'g_1:2');
  assert.equal(C.roundIdOf(attrs({ 'data-round-id': '<script>' })), null);
  assert.equal(C.roundIdOf(attrs({ title: 'Round 5' })), null);
});

test('diffStrip: the first look sends nothing; newest-first strips send the new rounds oldest first', () => {
  assert.deepEqual(C.diffStrip(null, strip(1.5, 2, 3, 4, 5)).added, []);
  const prev = strip(1.5, 2, 3, 4, 5, 6);
  const one = C.diffStrip(prev, strip(9.9, 1.5, 2, 3, 4, 5));   // fixed length: the oldest drops off
  assert.deepEqual([one.added.map((x) => x.m), one.dir], [[9.9], 'prepend']);
  const two = C.diffStrip(prev, strip(1.1, 9.9, 1.5, 2, 3, 4, 5, 6));
  assert.deepEqual(two.added.map((x) => x.m), [9.9, 1.1]);
  assert.deepEqual(C.diffStrip(prev, prev.slice()).added, [], 'no change, nothing sent');
});

test('diffStrip: newest-last strips, ids when the game shows them, and a resync when nothing lines up', () => {
  const prev = strip(1.5, 2, 3, 4, 5, 6);
  const app = C.diffStrip(prev, strip(2, 3, 4, 5, 6, 7.5));
  assert.deepEqual([app.added.map((x) => x.m), app.dir], [[7.5], 'append']);
  const ids = (list) => list.map(([m, id]) => ({ m, id }));
  const byId = C.diffStrip(ids([[2, 'a'], [2, 'b'], [2, 'c'], [2, 'd'], [2, 'e']]),
    ids([[2, 'f'], [2, 'a'], [2, 'b'], [2, 'c'], [2, 'd']]));
  assert.deepEqual(byId.added, [{ m: 2, id: 'f' }]);
  const lost = C.diffStrip(prev, strip(8, 8, 8, 8, 8, 8));
  assert.deepEqual([lost.added, lost.resync], [[], true]);
});

test('messages: only multiplier, seen_at and a visible round id; catch-up rounds 3 s apart', () => {
  const m = C.messages([{ m: 1.2, id: null }, { m: 3.4, id: 'r9' }], 1_000_000);
  assert.deepEqual(m, [{ multiplier: 1.2, seen_at: 1_000_000 - C.GAP_MS }, { multiplier: 3.4, seen_at: 1_000_000,
    round_id: 'r9' }]);
});

test('read-only: the script never clicks, types or touches cookies, storage, forms or other channels', () => {
  const src = fs.readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const bad of [/\.click\(/, /dispatchEvent/, /document\.cookie/, /localStorage/, /sessionStorage/, /indexedDB/,
    /\.value\b/, /XMLHttpRequest/, /fetch\(/, /sendBeacon/, /\.submit\(/, /focus\(/, /innerHTML\s*=/]) {
    assert.doesNotMatch(src, bad, String(bad));
  }
  assert.equal((src.match(/postMessage\(/g) || []).length, 1, 'one send, to the rounds channel');
  assert.match(src, /ColonJetXRounds/);
});
