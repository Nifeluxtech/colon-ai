// Integration tests for credits in the chat flow (chat/reply.js + modules/billing, in-memory store, mocked
// provider): a reply settles its credits, a reply refused for credits never calls the model and gives the daily
// counter back, a provider failure refunds, staff are never charged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { respond } = require('../../src/modules/chat/reply');
const { createParser } = require('../../src/modules/ai/sse');
const policy = require('../../src/modules/safety/policy');
const billing = require('../../src/modules/billing');

function fakeRes() {
  const r = new EventEmitter();
  r.chunks = []; r.writableEnded = false; r.socket = null;
  r.writeHead = () => {};
  r.write = (c) => { r.chunks.push(String(c)); return true; };
  r.end = () => { r.writableEnded = true; };
  r.events = () => {
    const out = [];
    const p = createParser((e) => out.push({ event: e.event, data: JSON.parse(e.data) }));
    p.push(r.chunks.join('')); p.end();
    return out;
  };
  return r;
}
const routing = {
  providers: () => ({ mock: { name: 'Mock', baseUrl: 'https://mock.provider/v1', apiKey: 'k' } }),
  targets: () => ({ m: [{ provider: 'mock', model: 'mock-1' }] }),
  routes: { general: ['m'], study: ['m'], research: ['m'], developer: ['m'], african: ['m'] },
  africanLanguages: ['yo', 'pcm', 'ha', 'ig'], models: [],
};
// OpenAI-style streaming mock: answers with `pieces` (or a function of the request body).
function modelFetch(pieces) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const list = typeof pieces === 'function' ? pieces(body) : pieces;
    const enc = new TextEncoder();
    const parts = list.map(t => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
      .concat('data: [DONE]\n\n');
    let i = 0;
    return new Response(new ReadableStream({ async pull(c) {
      await new Promise((r) => setTimeout(r, 1));
      if (i < parts.length) c.enqueue(enc.encode(parts[i++])); else c.close();
    } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  fn.calls = calls;
  return fn;
}
function memStore() {
  const s = { saved: null };
  s.start = async () => ({ id: 'm1', role: 'assistant', content: '', status: 'streaming' });
  s.finish = async (x) => { s.saved = x; return { id: 'm1', role: 'assistant', content: x.content,
    status: x.status }; };
  return s;
}
function fakeDb() {
  const rows = [];
  return { rows, async query(sql, p) { if (/INSERT INTO safety_events/.test(sql)) rows.push({ sql, p }); return []; },
    async one() { return null; } };
}
const fast = { firstTokenTimeoutMs: 2000, idleTimeoutMs: 2000, maxReplyMs: 5000, hedge: 1 };
const ENV = { enabled: true, providerModeration: false, moderationKey: '', moderationUrl: '', logText: 'off' };
const PLANS = [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 }];
const ENTS = [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 2 }];
function engine(mode = 'enforce') {
  const store = billing.memoryStore({ plans: PLANS, entitlements: ENTS });
  return { e: billing.create({ store, cfg: { mode, credits: { chat: 1, research: 3, saga: 2 } }, cacheMs: 0 }),
    s: store._s };
}

async function run(engineObj, { user = { id: 7, role: 'user' }, pieces = ['Hello there. '], fetch, id = 'm1',
  counters = [] } = {}) {
  const res = fakeRes(); const store = memStore(); store.start = async () => ({ id, role: 'assistant', content: '',
    status: 'streaming' });
  const f = fetch || modelFetch(pieces);
  const db = fakeDb();
  await respond({ req: { user }, res, mode: 'general', language: 'en', history: [{ role: 'user', content: 'Hi' }],
    counters, store, routing, fetch: f, timeouts: fast, userText: 'Hi', searchText: 'Hi', route: 'chat.send', db,
    safetySettings: policy.merge({}), safetyEnv: ENV, billing: engineObj });
  return { ev: res.events(), store, fetch: f, db };
}

test('a delivered reply reserves then settles one credit', async () => {
  const { e, s } = engine();
  const { ev } = await run(e);
  assert.equal(ev.at(-1).event, 'done');
  assert.equal(s.wallets.get('7').balance, 1);
  const u = s.usage.get('chat:m1');
  assert.equal(u.status, 'settled');
  assert.equal(u.credits_charged, 1);
  assert.equal(u.model, 'mock-1');
});

test('out of credits: quota error, no model call, daily counter given back', async () => {
  const { e } = engine();
  await run(e, { id: 'a' }); await run(e, { id: 'b' });
  const counted = [];
  const fakeLimitsDb = { async query(sql, [subject]) { if (/INSERT INTO chat_usage/.test(sql)) counted.push(subject);
    else if (/requests - 1/.test(sql)) counted.pop(); return []; }, async one() { return { requests: 1 }; } };
  const res = fakeRes(); const store = memStore(); const f = modelFetch(['x']);
  await respond({ req: { user: { id: 7, role: 'user' } }, res, mode: 'general', language: 'en',
    history: [{ role: 'user', content: 'Hi' }], counters: [{ subject: 'u:7', limit: 100 }], store, routing, fetch: f,
    timeouts: fast, userText: 'Hi', searchText: 'Hi', route: 'chat.send', db: fakeLimitsDb,
    safetySettings: policy.merge({}), safetyEnv: ENV, billing: e });
  const ev = res.events();
  const err = ev.find((x) => x.event === 'error');
  assert.equal(err.data.code, 'quota');
  assert.match(err.data.message, /Colon credits on the Free plan/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(counted, []);
});

test('provider failure before any text refunds the credit', async () => {
  const { e, s } = engine();
  const down = async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
  down.calls = [];
  const { ev } = await run(e, { fetch: down });
  assert.equal(ev.find((x) => x.event === 'error').data.code, 'provider_down');
  assert.equal(s.usage.get('chat:m1').status, 'refunded');
  assert.equal(s.wallets.get('7').balance, 2);
});

test('staff are never charged', async () => {
  const { e, s } = engine();
  await run(e, { user: { id: 1, role: 'admin' } });
  assert.equal(s.ledger.length, 0);
});
