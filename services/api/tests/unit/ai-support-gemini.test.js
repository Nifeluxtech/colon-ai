// Gemini support models (0.11.0, modules/ai/support.js, hedge.js): after Gemma 4 26B -> 31B, three Google AI Studio
// models on the same key (gemini-flash-lite-latest, gemini-3.5-flash-lite, gemini-3.8-flash), then Groq and
// OpenRouter. Each rests on its own (per model), and a withdrawn model ("not found" / "not available") is skipped for
// a day without failing the reply. fetch is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../../src/modules/ai');
const routing = require('../../src/modules/ai/routing');
const support = require('../../src/modules/ai/support');

const KEYS = ['GEMINI_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NATLAS_API_KEY',
  'NVIDIA_GEMMA_MODEL', 'AI_MODEL_SET', 'AI_SUPPORT_MODELS', 'GROQ_SUPPORT_MODEL', 'OPENROUTER_SUPPORT_MODEL',
  'AI_RETRY_WAIT_MS', 'GEMINI_SUPPORT_MODELS', 'GEMINI_SUPPORT_VISION', 'GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS'];
function withEnv(t, vars) {
  const was = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  t.after(() => {
    for (const k of KEYS) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
    ai._resting.clear();
  });
}
const ids = (chain) => chain.map(c => `${c.providerId}:${c.model}`);
const SSE = (text) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
  + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const GEM = (text) => new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] },
  finishReason: 'STOP' }] })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const ERR = (status, message) => new Response(JSON.stringify({ error: { code: status, message } }), { status });
const T = { firstTokenTimeoutMs: 2000, idleTimeoutMs: 2000, maxReplyMs: 4000 };
const model = (url) => decodeURIComponent(/\/models\/([^:]+):/.exec(url)[1]);
const GEMINI3 = ['gemini:gemini-flash-lite-latest', 'gemini:gemini-3.5-flash-lite', 'gemini:gemini-3.8-flash'];
const msgs = [{ role: 'user', content: 'hi' }];

test('order: Gemma 26B, 31B, the three Gemini models, then Groq and OpenRouter', (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o' });
  assert.deepEqual(ids(ai.chainFor({}, routing)), ['gemini:gemma-4-26b-a4b-it', 'gemini:gemma-4-31b-it',
    ...GEMINI3, 'groq:openai/gpt-oss-120b', 'openrouter:google/gemma-4-31b-it:free']);
  // Same for Saga's browser decisions (category reasoning).
  assert.deepEqual(ids(ai.chainFor({ category: 'reasoning' }, routing)).slice(2, 5), GEMINI3);
  assert.deepEqual(support.list().slice(0, 3).map(s => s.model), ['gemini-flash-lite-latest',
    'gemini-3.5-flash-lite', 'gemini-3.8-flash']);
});

test('GEMINI_SUPPORT_MODELS: a list of its own, "off" = none; AI_SUPPORT_MODELS can place them anywhere', (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', GEMINI_SUPPORT_MODELS: 'gemini-3.5-flash-lite' });
  assert.deepEqual(ids(ai.chainFor({}, routing)).slice(2), ['gemini:gemini-3.5-flash-lite',
    'groq:openai/gpt-oss-120b']);
  process.env.GEMINI_SUPPORT_MODELS = 'off';
  assert.deepEqual(ids(ai.chainFor({}, routing)).slice(2), ['groq:openai/gpt-oss-120b']);
  process.env.AI_SUPPORT_MODELS = 'groq:openai/gpt-oss-120b, gemini:gemini-3.8-flash';
  assert.deepEqual(ids(ai.chainFor({}, routing)).slice(2), ['groq:openai/gpt-oss-120b', 'gemini:gemini-3.8-flash']);
  // Without the Google key, none of them (and no Gemma either).
  delete process.env.AI_SUPPORT_MODELS; delete process.env.GEMINI_SUPPORT_MODELS; delete process.env.GEMINI_API_KEY;
  assert.ok(!ai.chainFor({}, routing).some(c => c.support && c.providerId === 'gemini'));
});

test('vision: the Gemini support models read images, Groq gpt-oss does not; 3.8 Flash thinks "low"', (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' });
  const chain = ai.chainFor({ needsVision: true }, routing);
  assert.deepEqual(ids(chain.filter(c => c.support)), GEMINI3);
  const e = support.entries(ai.enabledProviders(routing));
  // gemini-3.8-flash rejects thinkingLevel "minimal" (Gemma's), so it asks for "low".
  assert.deepEqual(e.find(c => c.model === 'gemini-3.8-flash').body, { thinkingConfig: { thinkingLevel: 'low' } });
  // A GEMINI_SUPPORT_MODELS that still names gemini-2.5-flash keeps its thinkingBudget 0.
  const old = support.entries(ai.enabledProviders(routing),
    { ...process.env, GEMINI_SUPPORT_MODELS: 'gemini-2.5-flash' });
  assert.deepEqual(old.find(c => c.model === 'gemini-2.5-flash').body, { thinkingConfig: { thinkingBudget: 0 } });
  assert.equal(e.find(c => c.model === 'gemini-3.5-flash-lite').body, null);
  process.env.GEMINI_SUPPORT_VISION = '0';
  assert.equal(ai.chainFor({ needsVision: true }, routing).filter(c => c.support).length, 0);
});

test('a 429 on Gemma rests only Gemma: Flash-Lite latest answers and stays awake (rest key is per model)',
  async (t) => {
    withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', AI_RETRY_WAIT_MS: '0' });
    const asked = [], bodies = {};
    const fetch = async (url, init) => {
      const m = model(url); asked.push(m); bodies[m] = JSON.parse(init.body);
      return /gemma/.test(m) ? ERR(429, 'Resource has been exhausted') : GEM('From Flash-Lite');
    };
    const r = await ai.generate({ messages: msgs, fetch, routing, timeouts: T });
    assert.equal(r.model, 'gemini-flash-lite-latest');
    assert.equal(r.support, true);
    assert.deepEqual(asked, ['gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-flash-lite-latest']);
    assert.equal(bodies['gemini-flash-lite-latest'].generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.ok(ai._resting.get('gemini|gemma-4-26b-a4b-it') > Date.now());
    assert.ok(!ai._resting.has('gemini|gemini-flash-lite-latest'));
    assert.ok(!ai._resting.has('gemini|gemini-3.5-flash-lite'));
    // Next request: the rested Gemma models go last, the Gemini support models lead.
    assert.deepEqual(ids(ai.chainFor({}, routing)).slice(0, 3), GEMINI3);
  });

test('gemini-3.8-flash "not found" is skipped (rested ~24 h) and the reply still comes', async (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', AI_RETRY_WAIT_MS: '0' });
  const asked = [];
  let sent38 = null;
  const fetch = async (url, init) => {
    if (/groq/.test(url)) { asked.push('groq'); return SSE('From Groq'); }
    const m = model(url); asked.push(m);
    if (m === 'gemini-3.8-flash') {
      sent38 = JSON.parse(init.body);
      return ERR(404, 'models/gemini-3.8-flash is not found for API version v1beta');
    }
    return ERR(429, 'Resource has been exhausted');
  };
  const r = await ai.generate({ messages: msgs, fetch, routing, timeouts: T });
  assert.equal(r.model, 'openai/gpt-oss-120b');
  assert.deepEqual(asked.slice(-2), ['gemini-3.8-flash', 'groq']);
  assert.deepEqual(sent38.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  const until = ai._resting.get('gemini|gemini-3.8-flash') - Date.now();
  assert.ok(until > 23 * 3600e3 && until <= 24 * 3600e3, String(until));
  // A 429 rests the 3.5 Flash-Lite for about a minute only.
  assert.ok(ai._resting.get('gemini|gemini-3.5-flash-lite') - Date.now() <= 60e3);
});

test('unavailable(): 404, or 403/400 saying not found / not available; never a plain 429 or another host', () => {
  const c = { support: true, providerId: 'gemini', model: 'gemini-3.8-flash' };
  assert.equal(support.unavailable(c, { status: 404, code: 'model_not_found', message: 'x' }), true);
  assert.equal(support.unavailable(c, { status: 403, code: 'auth',
    message: 'This model is not available to new users.' }), true);
  assert.equal(support.unavailable(c, { status: 400, code: 'http_400',
    message: 'models/gemini-3.8-flash is no longer available' }), true);
  assert.equal(support.unavailable(c, { status: 403, code: 'auth', message: 'API key not valid' }), false);
  assert.equal(support.unavailable(c, { status: 429, code: 'rate_limited', message: 'not available' }), false);
  assert.equal(support.unavailable({ ...c, providerId: 'groq' }, { status: 404, code: 'model_not_found' }), false);
  assert.equal(support.unavailable({ ...c, support: false }, { status: 404, code: 'model_not_found' }), false);
  assert.equal(support.unavailableRestMs({ GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS: '2' }), 2 * 3600e3);
});
