// AI_MODEL_SET (modules/ai/model-set.js, 0.10.6): Saga uses Gemma 4 only by default: Gemma 4 26B on Google AI
// Studio, Gemma 4 31B only when 26B fails, one at a time; "all" restores the full routing table. fetch is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const ms = require('../../src/modules/ai/model-set');
const ai = require('../../src/modules/ai');
const routing = require('../../src/modules/ai/routing');

const KEYS = ['GEMINI_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NATLAS_API_KEY',
  'NVIDIA_GEMMA_MODEL', 'AI_MODEL_SET'];
function withEnv(t, vars) {
  const was = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  t.after(() => {
    for (const k of KEYS) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
  });
}
const ALL_KEYS = { GEMINI_API_KEY: 'g', NVIDIA_API_KEY: 'n', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o',
  NATLAS_API_KEY: 'a', NVIDIA_GEMMA_MODEL: 'google/gemma-4-31b-it' };
const ids = (chain) => chain.map(c => `${c.providerId}:${c.model}`);

test('the setting: gemma unless it says all', () => {
  assert.equal(ms.modelSet(undefined), 'gemma');
  assert.equal(ms.modelSet(''), 'gemma');
  assert.equal(ms.modelSet('ALL'), 'all');
  assert.equal(ms.modelSet('nonsense'), 'gemma');
  const { SCHEMA } = require('../../src/config/defaults');
  assert.equal(SCHEMA.find(i => i.key === 'AI_MODEL_SET').default, 'gemma');
});

test('default: every mode, language and category is Gemma 4 26B then 31B on Google; no other model or host', (t) => {
  withEnv(t, ALL_KEYS);
  for (const o of [{}, { mode: 'developer', category: 'code' }, { language: 'ha', category: 'hausa' },
    { mode: 'study', category: 'exam' }, { model: 'colon-saga-fast' }]) {
    const chain = ai.chainFor(o, routing);
    assert.deepEqual(ids(chain), ['gemini:gemma-4-26b-a4b-it', 'gemini:gemma-4-31b-it'], JSON.stringify(o));
    assert.match(chain.route, /^gemma/);
  }
});

test('all: the full table comes back (MiniMax, N-ATLaS, Qwen…)', (t) => {
  withEnv(t, { ...ALL_KEYS, AI_MODEL_SET: 'all' });
  const chain = ids(ai.chainFor({ language: 'ha' }, routing));
  assert.ok(chain.length > 2);
  assert.ok(chain.some(x => /minimax/.test(x)));
});

test('without a Google key: Gemma 4 on another host (never NVIDIA); with no Gemma 4 at all, the plain chain', (t) => {
  withEnv(t, { OPENROUTER_API_KEY: 'o', NVIDIA_API_KEY: 'n', NVIDIA_GEMMA_MODEL: 'google/gemma-4-31b-it' });
  assert.deepEqual(ids(ai.chainFor({}, routing)), ['openrouter:google/gemma-4-31b-it:free']);
  const mock = { providers: () => ({ m: { name: 'M', baseUrl: 'http://x', apiKey: 'k' } }),
    targets: () => ({ a: [{ provider: 'm', model: 'mock-1' }] }), routes: { general: ['a'] },
    africanLanguages: [], models: [] };
  assert.deepEqual(ids(ai.chainFor({}, mock)), ['m:mock-1']);
});

test('generate: one model at a time even with hedge 3; 31B only after 26B failed', async (t) => {
  withEnv(t, ALL_KEYS);
  const asked = [];
  const fetch = async (url) => {
    asked.push(decodeURIComponent(String(url).split('/models/')[1] || url).split(':')[0]);
    if (/26b/.test(url)) return new Response('{"error":{"message":"busy"}}', { status: 429 });
    const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"Sannu"}]},"finishReason":"STOP"}]}\n\n';
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const r = await ai.generate({ messages: [{ role: 'user', content: 'Ina kwana?' }], language: 'ha', fetch,
    routing, timeouts: { hedge: 3, firstTokenTimeoutMs: 2000, idleTimeoutMs: 2000, maxReplyMs: 4000 } });
  assert.equal(r.model, 'gemma-4-31b-it');
  assert.deepEqual(asked, ['gemma-4-26b-a4b-it', 'gemma-4-31b-it']);
  ai._resting.clear();
});
