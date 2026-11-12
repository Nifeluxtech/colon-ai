// ColonStore.prefs falls back to memory when localStorage is missing (Node, private windows).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ColonStore: Store } = require('../js/store.js');

test('prefs merge defaults, persist patches, and reset', () => {
  const p = Store.prefs('t.prefs', { a: 1, b: { c: 2 } });
  assert.deepEqual(p.get(), { a: 1, b: { c: 2 } });
  p.set({ a: 5 });
  assert.equal(p.get().a, 5);
  assert.deepEqual(p.reset(), { a: 1, b: { c: 2 } });
});
