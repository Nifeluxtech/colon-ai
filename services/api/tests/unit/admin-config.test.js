// Unit tests for the Admin Dashboard live config (Phase 4): routing from the database with fallback to
// routing.js, cached settings, system settings and feature flags, live limits and the AI call log.
// No database (a fake db module stands in), no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
// Stand-in for src/db so route modules load without MySQL. Any query made by a guard-passing handler is recorded.
const dbPath = require.resolve('../../src/db');
const fakeDb = { calls: [], async query(sql, p) { this.calls.push(sql); return []; }, async one() { return null; } };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
const routingDefault = require('../../src/modules/ai/routing');
const dynamic = require('../../src/modules/ai/dynamic');
const ai = require('../../src/modules/ai/generate');
const settings = require('../../src/shared/settings');
const limits = require('../../src/modules/ai/limits');
const calls = require('../../src/modules/ai/calls');
const { encrypt, decrypt } = require('../../src/shared/crypto');
/* ---------- Live routing ---------- */
const ENV = { GROQ_API_KEY: 'g', NVIDIA_API_KEY: 'n', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', NATLAS_API_KEY: '', NATLAS_BASE_URL: '' };
function withEnv(fn) {
  const old = {}; for (const k of Object.keys(ENV)) { old[k] = process.env[k]; process.env[k] = ENV[k]; }
  try { return fn(); } finally { for (const k of Object.keys(ENV)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
}
test('routing: an empty database means the built-in routing.js table', () => withEnv(() => {
  const cfg = dynamic.compose({});
  assert.equal(cfg.source, 'default');
  assert.deepEqual(cfg.routes, routingDefault.routes);
  assert.deepEqual(Object.keys(cfg.targets()), Object.keys(routingDefault.targets()));
}));
test('routing: DB models, per-mode order and hedge from the dashboard; unknown slots ignored', () => withEnv(() => {
  const modelRows = [
    { id: 1, target: 'qwen', provider_id: 'groq', model: 'qwen-x', vision: 0, body: null, enabled: 1, priority: 0 },
    { id: 2, target: 'fast', provider_id: 'nvidia', model: 'fast-1', vision: 0, body: '{"a":1}', enabled: 1, priority: 0 },
    { id: 3, target: 'fast', provider_id: 'groq', model: 'fast-0', vision: 1, body: null, enabled: 1, priority: -1 },
    { id: 4, target: 'off', provider_id: 'groq', model: 'off-1', vision: 0, body: null, enabled: 0, priority: 0 },
  ];
  const cfg = dynamic.compose({ modelRows, routing: { routes: { study: ['fast', 'qwen'], general: ['nope'] }, hedge: 3 } });
  assert.equal(cfg.source, 'database');
  assert.equal(cfg.hedge, 3);
  assert.deepEqual(cfg.routes.study, ['fast', 'qwen']);
  assert.deepEqual(cfg.targets().fast.map(t => t.model), ['fast-0', 'fast-1']);   // priority order
  assert.deepEqual(cfg.targets().fast[1].body, { a: 1 });
  assert.equal(cfg.targets().off, undefined);                                      // disabled rows dropped
  assert.notDeepEqual(cfg.routes.general, ['nope']);                               // a route with no real slot keeps a working default
  const chain = ai.chainFor({ mode: 'study', language: 'en' }, cfg).map(c => c.model);
  assert.deepEqual(chain, ['fast-0', 'fast-1', 'qwen-x']);
}));
test('routing: provider rows override name/URL, a stored key wins over env, disabled providers drop out', () => withEnv(() => {
  const box = encrypt('db-key');
  const providerRows = [
    { id: 'groq', name: 'Groq DB', base_url: 'https://groq.example/v1', native: '', api_key_enc: box, enabled: 1 },
    { id: 'nvidia', name: 'NVIDIA', base_url: '', native: '', api_key_enc: null, enabled: 0 },
    { id: 'custom', name: 'Custom', base_url: 'https://custom.example/v1', native: '', api_key_enc: encrypt('c-key'), enabled: 1 },
  ];
  const modelRows = [
    { id: 1, target: 'qwen', provider_id: 'groq', model: 'q', vision: 0, enabled: 1, priority: 0 },
    { id: 2, target: 'deepseek', provider_id: 'nvidia', model: 'd', vision: 0, enabled: 1, priority: 0 },
    { id: 3, target: 'my', provider_id: 'custom', model: 'm', vision: 0, enabled: 1, priority: 0 },
  ];
  const cfg = dynamic.compose({ providerRows, modelRows, decrypt });
  const p = cfg.providers();
  assert.equal(p.groq.apiKey, 'db-key');
  assert.equal(p.groq.baseUrl, 'https://groq.example/v1');
  assert.equal(p.nvidia.apiKey, '');
  assert.equal(p.custom.apiKey, 'c-key');
  assert.deepEqual(Object.keys(ai.enabledProviders(cfg)).sort(), ['custom', 'groq']);
  // An env key is the fallback when no key is stored.
  const cfg2 = dynamic.compose({ providerRows: [{ id: 'groq', name: 'Groq', base_url: '', native: '', api_key_enc: null, enabled: 1 }], decrypt });
  assert.equal(cfg2.providers().groq.apiKey, 'g');
}));
test('routing: a DB config with no usable model falls back to routing.js (chat never breaks)', () => withEnv(() => {
  const modelRows = [{ id: 1, target: 'qwen', provider_id: 'natlas', model: 'x', vision: 0, enabled: 1, priority: 0 }];
  const cfg = dynamic.compose({ modelRows, routing: { hedge: 2 } });
  assert.match(cfg.source, /^default/);
  assert.equal(cfg.hedge, 2);
  assert.ok(ai.isConfigured(cfg));
  // An unreadable stored key (e.g. APP_SECRET changed) falls back to the env key.
  const bad = dynamic.compose({ providerRows: [{ id: 'groq', name: 'Groq', base_url: '', api_key_enc: 'v1.bad.box.x', enabled: 1 }], decrypt });
  assert.equal(bad.providers().groq.apiKey, 'g');
}));
test('routing: load() caches ~30 s and falls back to defaults when the database fails', async () => {
  dynamic.clear();
  let n = 0;
  const broken = { query: async () => { n++; throw new Error('ER_NO_SUCH_TABLE'); }, one: async () => { throw new Error('down'); } };
  const a = await dynamic.load(broken, 1000);
  assert.equal(a.source, 'default');
  assert.deepEqual(a.routes, routingDefault.routes);
  await dynamic.load(broken, 1000 + 10000);
  assert.equal(n, 2);                         // second call served from cache (2 = the first build's two queries)
  await dynamic.load(broken, 1000 + 31000);
  assert.ok(n > 2);                           // cache expired
  dynamic.clear();
});
/* ---------- Settings ---------- */
test('settings: cached per worker for 30 s, last good value kept when the database fails', async () => {
  settings.clear();
  let value = JSON.stringify({ x: 1 }), reads = 0, fail = false;
  const db = { one: async () => { reads++; if (fail) throw new Error('down'); return { v: value }; } };
  assert.deepEqual(await settings.get('k', db, 0), { x: 1 });
  value = JSON.stringify({ x: 2 });
  assert.deepEqual(await settings.get('k', db, 20000), { x: 1 });
  assert.equal(reads, 1);
  assert.deepEqual(await settings.get('k', db, 31000), { x: 2 });
  fail = true;
  assert.deepEqual(await settings.get('k', db, 70000), { x: 2 });
  settings.clear();
  assert.equal(await settings.get('k', db, 0), null);
  settings.clear();
});
test('system settings merge with safe defaults; feature flags block members, never staff', async () => {
  const s = settings.mergeSystem({ features: { uploads: false }, maintenance: { on: true } });
  assert.equal(s.brandName, 'Colon AI');
  assert.equal(s.features.uploads, false);
  assert.equal(s.features.registration, true);
  assert.equal(s.maintenance.on, true);
  assert.ok(s.maintenance.message.length > 10);
  settings.clear();
  const db = { one: async () => ({ v: JSON.stringify({ features: { uploads: false } }) }) };
  await settings.get('system', db);   // prime the cache
  const guard = settings.feature('uploads');
  await assert.rejects(guard({ user: { role: 'user' } }), (e) => e.status === 403 && e.code === 'feature_off');
  await guard({ user: { role: 'admin' } });
  settings.clear();
});
/* ---------- Limits ---------- */
test('limits: dashboard values override env, per-mode caps, per-user override, staff exempt from mode caps', async () => {
  const base = { dailyLimit: 100, guestDailyLimit: 15, guestIpDailyLimit: 300 };
  const m = limits.mergeLimits(base, { user: 50, guest: 0, modes: { research: 3, study: '', bad: 1 } });
  assert.equal(m.dailyLimit, 50);
  assert.equal(m.guestDailyLimit, 0);
  assert.equal(m.guestIpDailyLimit, 300);
  assert.deepEqual(m.modes, { research: 3 });
  const st = { get: async () => ({ user: 50, modes: { research: 3 } }) };
  const db = { one: async () => ({ daily_limit: 7 }) };
  const user = await limits.resolveCounters({ user: { id: 4, role: 'user' } }, 'research', db, st);
  assert.deepEqual(user, [{ subject: 'u:4', limit: 7 }, { subject: 'u:4:research', limit: 3, mode: 'research' }]);
  const staff = await limits.resolveCounters({ user: { id: 5, role: 'admin' } }, 'research', { one: async () => null }, st);
  assert.deepEqual(staff, [{ subject: 'u:5', limit: 1000 }]);
  const guest = await limits.resolveCounters({ user: null, ip: '1.2.3.4', cookies: {} }, 'general', db, st);
  assert.equal(guest.length, 2);
  assert.match(guest[0].subject, /^g:/);
  // The per-mode cap gives its own message.
  const fake = new Map();
  const fdb = { async query(sql, [s]) { if (/^\s*INSERT/.test(sql)) fake.set(s, (fake.get(s) || 0) + 1); else if (/- 1/.test(sql)) fake.set(s, fake.get(s) - 1); return []; }, async one(sql, [s]) { return { requests: fake.get(s) || 0 }; } };
  await limits.consumeAll(user, fdb);
  await limits.consumeAll(user, fdb);
  await limits.consumeAll(user, fdb);
  await assert.rejects(limits.consumeAll(user, fdb), (e) => e.code === 'quota' && /Research mode/.test(e.message));
  assert.equal(fake.get('u:4'), 3);   // the refused reply was given back
});
/* ---------- AI call log ---------- */
test('ai_calls: one row per attempt; a request with no attempt still records its error', () => {
  const rows = calls.rowsFor({ mode: 'study', route: 'study', guest: true, attempts: [{ provider: 'groq', model: 'q', ok: false, code: 'timeout', ms: 25000 }, { provider: 'nvidia', model: 'd', ok: true, ms: 1200.4 }] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], rows[1][0]);                 // same request id
  assert.deepEqual(rows[0].slice(1), ['study', 'study', 'groq', 'q', 0, 'timeout', null, 25000, 1]);
  assert.deepEqual(rows[1].slice(5, 9), [1, null, null, 1200]);
  const none = calls.rowsFor({ mode: 'general', code: 'no_provider' });
  assert.equal(none.length, 1);
  assert.equal(none[0][6], 'no_provider');
});
