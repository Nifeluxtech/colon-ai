// Support models (0.11.0, modules/ai/support.js, fit.js, hedge.js): after Gemma 4 on Google, Groq gpt-oss-120b then
// OpenRouter's free Gemma 4 31B, each only with its key; Retry-After honoured; small hosts get a trimmed prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../../src/modules/ai');
const routing = require('../../src/modules/ai/routing');
const support = require('../../src/modules/ai/support');
const { fit, total } = require('../../src/modules/ai/fit');

const KEYS = ['GEMINI_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NATLAS_API_KEY',
  'NVIDIA_GEMMA_MODEL', 'AI_MODEL_SET', 'AI_SUPPORT_MODELS', 'GROQ_SUPPORT_MODEL', 'OPENROUTER_SUPPORT_MODEL',
  'AI_RETRY_WAIT_MS', 'GROQ_SUPPORT_MAX_INPUT_TOKENS', 'GEMINI_SUPPORT_MODELS'];
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
const GEM = 'data: {"candidates":[{"content":{"parts":[{"text":"Gemma"}]},"finishReason":"STOP"}]}\n\n';
const T = { firstTokenTimeoutMs: 2000, idleTimeoutMs: 2000, maxReplyMs: 4000 };

test('only providers with a key; AI_SUPPORT_MODELS overrides; off = none', (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', GEMINI_SUPPORT_MODELS: 'off' });
  assert.deepEqual(ids(ai.chainFor({}, routing)), ['gemini:gemma-4-26b-a4b-it', 'gemini:gemma-4-31b-it',
    'groq:openai/gpt-oss-120b']);
  process.env.AI_SUPPORT_MODELS = 'openrouter:google/gemma-4-31b-it:free, groq:llama-x, bogus:y';
  assert.deepEqual(support.list(), [{ provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
    { provider: 'groq', model: 'llama-x' }]);
  assert.deepEqual(ids(ai.chainFor({}, routing)).slice(2), ['groq:llama-x']);  // no OpenRouter key
  process.env.AI_SUPPORT_MODELS = 'off';
  assert.equal(ai.chainFor({}, routing).filter(c => c.support).length, 0);
  process.env.AI_SUPPORT_MODELS = '';
  process.env.GROQ_SUPPORT_MODEL = 'off';
  assert.equal(ai.chainFor({}, routing).filter(c => c.support).length, 0);
});

test('AI_MODEL_SET=all keeps the full table (no support entries added)', (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', AI_MODEL_SET: 'all' });
  assert.ok(ai.chainFor({}, routing).every(c => !c.support));
});

test('Gemma busy on Google: the reply comes from Groq gpt-oss-120b, with reasoning_effort low', async (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', AI_RETRY_WAIT_MS: '0', GEMINI_SUPPORT_MODELS: 'off' });
  const asked = [];
  const fetch = async (url, init) => {
    if (/googleapis/.test(url)) { asked.push('google'); return new Response('{"error":{}}', { status: 429 }); }
    const b = JSON.parse(init.body); asked.push(b.model); assert.equal(b.reasoning_effort, 'low');
    return SSE('From Groq');
  };
  const r = await ai.generate({ messages: [{ role: 'user', content: 'hi' }], fetch, routing, timeouts: T });
  assert.equal(r.model, 'openai/gpt-oss-120b');
  assert.equal(r.support, true);
  assert.deepEqual(asked, ['google', 'google', 'openai/gpt-oss-120b']);
  assert.equal(ai.answered()[0].model, 'openai/gpt-oss-120b');
});

test('Retry-After of 1 s: the same model is asked again once; 30 s: it rests and the next is asked', async (t) => {
  withEnv(t, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', AI_SUPPORT_MODELS: 'off' });
  let n = 0;
  const fetch = async (url) => {
    if (/26b/.test(url) && n++ === 0) return new Response('{}', { status: 429, headers: { 'retry-after': '0.05' } });
    return new Response(GEM, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const r = await ai.generate({ messages: [{ role: 'user', content: 'hi' }], fetch, routing, timeouts: T });
  assert.equal(r.model, 'gemma-4-26b-a4b-it');
  assert.equal(r.attempts.length, 2);
  const asked = [];
  const slow = async (url) => {
    asked.push(/26b/.test(url) ? '26b' : '31b');
    if (/26b/.test(url)) return new Response('{}', { status: 429, headers: { 'retry-after': '30' } });
    return new Response(GEM, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const r2 = await ai.generate({ messages: [{ role: 'user', content: 'hi' }], fetch: slow, routing, timeouts: T });
  assert.equal(r2.model, 'gemma-4-31b-it');
  assert.deepEqual(asked, ['26b', '31b']);
  // Rested for at least the Retry-After: the next request asks 31B first.
  assert.equal(ai.chainFor({}, routing)[0].model, 'gemma-4-31b-it');
});

test('a big Saga prompt is trimmed for Groq (5000 tokens), the element list kept', async (t) => {
  withEnv(t, { GROQ_API_KEY: 'q', GEMINI_API_KEY: 'g', AI_RETRY_WAIT_MS: '0' });
  let sent = null;
  const fetch = async (url, init) => {
    if (/googleapis/.test(url)) return new Response('{}', { status: 503 });
    sent = JSON.parse(init.body).messages; return SSE('{"say":"ok","action":"finish","args":{}}');
  };
  const page = `Result of getPageContent: Page 1, URL: https://x.ng\n<<<UNTRUSTED\nTitle: X\nText:\n${'word '
    .repeat(9000)}\nElements:\nc1: button "Sign in"\nUNTRUSTED>>>`;
  await ai.generate({ messages: [{ role: 'user', content: 'The user\'s task: sign in' },
    { role: 'assistant', content: '{"action":"getPageContent"}' }, { role: 'user', content: page }],
  context: 'Saga rules', fetch, routing, timeouts: T });
  assert.ok(total(sent) <= 15000 + 100, String(total(sent)));
  assert.match(sent[sent.length - 1].content, /c1: button "Sign in"/);
  assert.match(sent[sent.length - 1].content, /\[shortened\]/);
});

test('fit leaves small prompts alone and never mutates the input', () => {
  const ms = [{ role: 'system', content: 's' }, { role: 'user', content: 'hello' }];
  assert.equal(fit(ms, 1000), ms);
  const big = [{ role: 'system', content: 'r'.repeat(5000) }, { role: 'user', content: 'u'.repeat(5000) }];
  const out = fit(big, 3000);
  assert.ok(total(out) <= 3100);
  assert.equal(big[1].content.length, 5000);
});
