// The chat.reconcile job (0.16.0, modules/chat/reconcile.js): a reply cut off by a restart gets its reserved credits
// back (Research mode: all 3), or settled when its text was saved, and is marked interrupted. Billing runs on its
// in-memory store in enforce mode; a fake db holds the chat messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const msgs = new Map();
const dbPath = require.resolve('../../src/db');
const fakeDb = {
  async query(sql, p) {
    if (/^UPDATE chat_messages SET status = 'error'/.test(sql)) {
      const m = msgs.get(p[1]);
      if (!m || m.status !== 'streaming') return { affectedRows: 0 };
      Object.assign(m, { status: 'error', error: p[0] }); return { affectedRows: 1 };
    }
    throw new Error(`unexpected SQL ${sql}`);
  },
  async one(sql, p) { const m = msgs.get(p[0]); return /FROM chat_messages/.test(sql) && m ? { ...m } : null; },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
const billing = require('../../src/modules/billing');
const reconcile = require('../../src/modules/chat/reconcile');

const PLANS = [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 }];
const ENTS = [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 100 }];
const user = { id: 7, role: 'user' };

test('interrupted replies: refunded when nothing was saved, settled when text was, finished ones untouched',
  async () => {
    const store = billing.memoryStore({ plans: PLANS, entitlements: ENTS, subs: {} });
    const engine = billing.create({ store, cfg: { mode: 'enforce', credits: { chat: 1, research: 3, saga: 2 } },
      cacheMs: 0 });
    msgs.set('m1', { id: 'm1', status: 'streaming', content: '' });              // Research reply, cut off early
    msgs.set('m2', { id: 'm2', status: 'streaming', content: 'Lagos is the largest city' });
    msgs.set('m3', { id: 'm3', status: 'complete', content: 'Done' });
    await engine.reserve({ user, requestId: 'chat:m1', feature: 'chat', mode: 'research' });
    await engine.reserve({ user, requestId: 'chat:m2', feature: 'chat', mode: 'general' });
    await engine.reserve({ user, requestId: 'chat:m3', feature: 'chat', mode: 'general' });
    await engine.settle({ user, requestId: 'chat:m3' });                         // a normal reply
    const balance = () => store._s.wallets.get('7').balance;
    assert.equal(balance(), 95);
    // Too soon: a reply may still be streaming on another worker.
    assert.equal((await reconcile.run({ engine, now: new Date() })).checked, 0);
    const later = new Date(Date.now() + reconcile.AFTER_MS + 1000);
    const r = await reconcile.run({ engine, now: later });
    assert.deepEqual(r, { checked: 2, refunded: 1, settled: 1, marked: 2 });
    assert.equal(balance(), 98);                                                 // the 3 Research credits came back
    assert.equal(msgs.get('m1').status, 'error');
    assert.equal(JSON.parse(msgs.get('m1').error).code, 'interrupted');
    assert.deepEqual([store._s.usage.get('chat:m1').status, store._s.usage.get('chat:m2').status], ['refunded',
      'settled']);
    assert.equal((await reconcile.run({ engine, now: later })).checked, 0);     // idempotent: nothing left open
  });
