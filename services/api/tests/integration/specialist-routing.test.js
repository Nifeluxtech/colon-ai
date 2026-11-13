// Integration test for specialist routing (v0.5.10) with the mock provider (tests/helpers/mock-provider.js, a real
// local HTTP server): a Hausa message goes through chat/reply.js to the benchmark's Hausa specialist, the
// ai_reply_ok log line names the route, switching the setting off restores the default chain, MiniMax-like weak
// models never join the first hedged wave, and Admin › Routing shows the table and saves the switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const mock = require('../helpers/mock-provider');
const { createParser } = require('../../src/modules/ai/sse');
const dynamic = require('../../src/modules/ai/dynamic');
const policy = require('../../src/modules/safety/policy');

const SETS = ['coding', 'everyday', 'hausa', 'igbo', 'jamb', 'pidgin', 'reasoning', 'tooluse', 'university', 'waec',
  'yoruba'];
const row = (model, provider, acc, ms) => ({ name: 'Colon benchmark it', provider, model, kind: 'bench',
  status: 'done', first_token_ms: ms, details: { sets: Object.fromEntries(SETS.map(s => [s, { n: 10,
    accuracy: (acc[s] ?? 100) / 100, first_token_ms: { median: ms } }])) } });
const BENCH = [row('gemma-a', 'mockg', { hausa: 90 }, 800), row('gemma-b', 'mockg', { hausa: 100 }, 1200),
  row('mini-m', 'mockn', { hausa: 50, yoruba: 60, igbo: 55 }, 900)];

function fakeRes() {
  const r = new EventEmitter();
  r.chunks = []; r.socket = null; r.writeHead = () => {}; r.end = () => {};
  r.write = (c) => { r.chunks.push(String(c)); return true; };
  r.events = () => {
    const out = [];
    const p = createParser((e) => out.push({ event: e.event, data: JSON.parse(e.data) }));
    p.push(r.chunks.join('')); p.end();
    return out;
  };
  return r;
}
const ENV = { enabled: true, providerModeration: false, moderationKey: '', moderationUrl: '', logText: 'off' };

test('chat reply: the Hausa specialist answers, the log names the route, off restores the default', async (t) => {
  const m = mock.create();
  const port = await m.listen();
  t.after(() => m.server.close());
  const url = `http://127.0.0.1:${port}/v1`;
  const base = {
    providers: () => ({ mockg: { name: 'Mock G', baseUrl: url, apiKey: 'k' },
      mockn: { name: 'Mock N', baseUrl: url, apiKey: 'k' } }),
    targets: () => ({ gemma: [{ provider: 'mockg', model: 'gemma-a' }], gemma31: [{ provider: 'mockg',
      model: 'gemma-b' }], minimax: [{ provider: 'mockn', model: 'mini-m' }] }),
    routes: { general: ['gemma', 'minimax', 'gemma31'], study: ['gemma', 'minimax', 'gemma31'],
      research: ['gemma', 'minimax', 'gemma31'], developer: ['gemma', 'minimax', 'gemma31'],
      african: ['gemma', 'gemma31', 'minimax'] },
    africanLanguages: ['pcm', 'yo', 'ha', 'ig'], models: [],
  };
  const { respond } = require('../../src/modules/chat/reply');
  const logs = [];
  const orig = console.error;
  console.error = (line) => { logs.push(String(line)); };
  t.after(() => { console.error = orig; });
  async function ask(text, routing, hedge = 1) {
    const res = fakeRes(); const saved = {};
    const before = m.calls.length;
    await respond({ req: { user: { id: 7 } }, res, mode: 'general', language: 'ha', counters: [],
      history: [{ role: 'user', content: text }], routing, userText: text, searchText: text, route: 'chat.send',
      db: { async query() { return []; }, async one() { return null; } }, safetySettings: policy.merge({}),
      safetyEnv: ENV, timeouts: { firstTokenTimeoutMs: 3000, idleTimeoutMs: 3000, maxReplyMs: 8000, hedge },
      store: { start: async () => ({ id: 'a1', role: 'assistant', content: '', status: 'streaming' }),
        finish: async (x) => Object.assign(saved, x) } });
    return { saved, models: m.calls.slice(before).map(c => c.body.model), ev: res.events() };
  }
  const on = dynamic.compose({ benchRows: BENCH }, base);
  const r1 = await ask('Ina kwana? Don allah menene babban birnin Najeriya?', on);
  assert.equal(r1.saved.providerModel, 'gemma-b', 'the Hausa specialist answered');
  assert.match(r1.saved.content, /^Mock reply \(gemma-b\)/);
  const ok = logs.map(l => { try { return JSON.parse(l); } catch { return {}; } }).filter(l => l.msg === 'ai_reply_ok');
  assert.equal(ok.at(-1).route, 'specialist:hausa', 'stderr ai_reply_ok carries the route');
  assert.equal(ok.at(-1).model, 'gemma-b');

  const off = dynamic.compose({ benchRows: BENCH, routing: { specialists: false } }, base);
  const r2 = await ask('Ina kwana? Don allah menene babban birnin Najeriya?', off);
  assert.equal(r2.saved.providerModel, 'gemma-a', 'switched off: the default leads again');
  assert.equal(JSON.parse(logs.filter(l => l.includes('ai_reply_ok')).at(-1)).route, 'default');

  // Hedge 2: before v0.5.10 the wave mixed providers and asked the weak model too; now it stays out.
  const r3 = await ask('Ina kwana? Don allah menene babban birnin Najeriya?', on, 2);
  assert.ok(!r3.models.includes('mini-m'), `weak model kept out of the first wave (asked: ${r3.models})`);
  assert.equal(r3.models[0], 'gemma-b');
  // A failing specialist still falls back down the whole chain (after one quick retry of the 5xx).
  const base500 = { ...base, targets: () => ({ ...base.targets(), gemma31: [{ provider: 'mockg',
    model: 'gemma-b-500' }] }) };
  const bench500 = BENCH.map(b => (b.model === 'gemma-b' ? { ...b, model: 'gemma-b-500' } : b));
  const r4 = await ask('Ina kwana? Don allah yaya lafiya?', dynamic.compose({ benchRows: bench500 }, base500));
  assert.equal(r4.models[0], 'gemma-b-500', 'specialist first');
  assert.equal(r4.models.at(-1), 'gemma-a', 'then the fallback');
  assert.equal(r4.saved.providerModel, 'gemma-a');
});

test('admin: GET /admin/routing shows specialists; PATCH saves the on/off switch and keeps it', async () => {
  const dbPath = require.resolve('../../src/db');
  const state = { setting: null, sql: [] };
  const fakeDb = {
    async query(sql, p) {
      state.sql.push(sql);
      if (/INSERT INTO app_settings/.test(sql)) { state.setting = p[1]; return { affectedRows: 1 }; }
      if (/FROM eval_runs/.test(sql)) return [];
      if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) return { insertId: 1, affectedRows: 1 };
      return [];
    },
    async one(sql) { return /FROM app_settings/.test(sql) && state.setting ? { v: state.setting } : null; },
  };
  const saved = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(
    dbPath)] };
  for (const k of Object.keys(require.cache)) if (/src[\\/](http|modules[\\/]admin|shared[\\/](audit|settings))/.test(
    k)) delete require.cache[k];
  try {
    const r = require('../../src/http/routes/admin');
    const settings = require('../../src/shared/settings');
    const find = (mth, p) => r.routes.find(x => x.method === mth && x.re.test(p)).handlers[1];
    const req = (body) => ({ user: { id: 1, role: 'admin', totp_enabled: 1 }, params: {}, body, ip: '', headers: {} });
    dynamic.clear(); settings.clear();
    const [, view] = await find('GET', '/admin/routing')(req({}));
    assert.equal(view.specialists.enabled, true, 'on by default');
    assert.equal(view.specialists.source, 'static', 'no imported benchmark: built-in table');
    assert.equal(view.specialists.categories.hausa.specialist, null);
    assert.deepEqual(view.specialists.categories.hausa.demoted, ['minimax']);
    assert.ok(view.specialists.labels.hausa);
    await assert.rejects(find('PATCH', '/admin/routing')(req({ specialists: 'nope' })), (e) => e.status === 422);
    const [st] = await find('PATCH', '/admin/routing')(req({ specialists: false }));
    assert.equal(st, 200);
    assert.equal(JSON.parse(state.setting).specialists, false);
    await find('PATCH', '/admin/routing')(req({ hedge: 1 }));
    assert.equal(JSON.parse(state.setting).specialists, false, 'kept when another field is saved');
    dynamic.clear(); settings.clear();
    const [, view2] = await find('GET', '/admin/routing')(req({}));
    assert.equal(view2.specialists.enabled, false);
    assert.equal(view2.specialists.setting, false);
  } finally {
    if (saved) require.cache[dbPath] = saved; else delete require.cache[dbPath];
    dynamic.clear();
  }
});
