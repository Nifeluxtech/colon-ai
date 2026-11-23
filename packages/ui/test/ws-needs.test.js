// v0.29.0 (Workspace step 5): the "=== NEEDS:" lines a build adds for a missing table or key.
const test = require('node:test');
const assert = require('node:assert/strict');
const { split, met } = require('../../../apps/chat/src/lib/ws-needs.js');

test('split takes NEEDS lines out of the note and parses them', () => {
  const r = split('Built the shop.\n=== NEEDS: table Orders read=owner add=public -- orders from checkout\n'
    + '=== NEEDS: secret paystack-key host=https://api.paystack.co/ as=bearer -- card payments\n'
    + '=== NEEDS: table orders add=public');
  assert.equal(r.text, 'Built the shop.');
  assert.deepEqual(r.needs, [
    { kind: 'table', name: 'orders', why: 'orders from checkout', read: 'owner', add: 'public' },
    { kind: 'secret', name: 'PAYSTACK_KEY', why: 'card payments', host: 'api.paystack.co', as: 'bearer' }]);
  assert.equal(met(r.needs[0], { collections: [{ name: 'orders' }], secrets: [] }), true);
  assert.equal(met(r.needs[1], { collections: [], secrets: [] }), false);
  assert.equal(split('=== NEEDS: secret K1 as=header:X-Key').needs[0].as, 'header:X-Key');
  assert.equal(split('=== NEEDS: secret K1 as=weird').needs[0].as, 'bearer');
});

test('v0.30.0: a connection need is met once that service is connected', () => {
  const n = split('Login pages ready.\n=== NEEDS: connection Supabase -- log in and register').needs[0];
  assert.deepEqual(n, { kind: 'connection', name: 'supabase', why: 'log in and register' });
  assert.equal(met(n, { connections: [] }), false);
  assert.equal(met(n, { connections: [{ provider: 'supabase' }] }), true);
});
