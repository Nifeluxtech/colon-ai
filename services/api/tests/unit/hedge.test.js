// Unit tests for hedged racing (modules/ai/hedge.js): a second Google model backs up the first, the fastest
// model wins, loser text never mixes in, failing waves and fast failures move on. fetch is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const KEYS = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'NATLAS_API_KEY', 'NATLAS_BASE_URL',
  'GROQ_MODEL', 'OPENROUTER_DEEPSEEK_MODEL', 'OPENROUTER_GEMMA_MODEL', 'GEMINI_MODEL', 'NATLAS_MODEL',
  'GEMINI_FALLBACK_MODEL', 'NVIDIA_API_KEY'];
function setEnv(vals) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vals);
}
const ALL = {
  GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o', GEMINI_API_KEY: 'm', NATLAS_API_KEY: 'n',
    NATLAS_BASE_URL: 'https://natlas.example/v1',
  GROQ_MODEL: 'qwen', OPENROUTER_DEEPSEEK_MODEL: 'deepseek', OPENROUTER_GEMMA_MODEL: 'gemma-or',
    GEMINI_MODEL: 'gemma-g', NATLAS_MODEL: 'natlas', GEMINI_FALLBACK_MODEL: 'off',
};
const ai = require('../../src/modules/ai/generate');
// A fetch Response streaming the given SSE chunks. opts.hang: never finish; opts.breakAfter: error after N chunks.
function sseResponse(chunks, opts = {}) {
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(ctl) {
      if (opts.breakAfter !== undefined && i >= opts.breakAfter) { ctl.error(new Error('socket hang up')); return; }
      if (i < chunks.length) { ctl.enqueue(enc.encode(chunks[i++])); return; }
      if (opts.hang) return new Promise(() => {});
      ctl.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const delta = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const okStream = (text) => sseResponse([...text.split(/(?<= )/).map(delta), 'data: [DONE]\n\n']);
const errResponse = (status) => new Response(JSON.stringify({ error: { message: `status ${status}` } }), { status,
  headers: { 'content-type': 'application/json' } });
// fetch mock: behaviour per model id; records the order of models called.
function mockFetch(behaviour) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    // Google AI Studio's native API carries the model in the URL, not the body.
    const native = /:streamGenerateContent/.exec(url) ? decodeURIComponent(url.split('/models/')[1].split(':')[
      0]) : null;
    const model = native || body.model;
    calls.push({ url, model, auth: init.headers.Authorization || init.headers['x-goog-api-key'], body, native: Boolean(
      native) });
    const b = behaviour[model] || 'ok';
    if (typeof b === 'number') return errResponse(b);
    if (b === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(
      new Error('aborted'), { name: 'AbortError' }))));
    if (b === 'hang-stream') return sseResponse([], { hang: true });
    if (b === 'drop') return sseResponse([delta('Partial '), delta('answer ')], { breakAfter: 2 });
    if (b === 'network') throw new TypeError('fetch failed');
    if (native) return sseResponse(`Answer from ${model}`.split(/(?<= )/).map(t => `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`));
    return okStream(`Answer from ${model}`);
  };
  fn.calls = calls;
  return fn;
}
const fast = { firstTokenTimeoutMs: 80, idleTimeoutMs: 200, maxReplyMs: 2000, hedge: 1 };
test.beforeEach(() => { ai._resting.clear(); setEnv(ALL); });
test('a second Google Gemma model backs up the first', async () => {
  setEnv({ GEMINI_API_KEY: 'm', GEMINI_MODEL: 'gemma-a' });
  const f = mockFetch({ 'gemma-a': 500 });
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f,
    timeouts: fast });
  assert.deepEqual(f.calls.map(c => c.model), ['gemma-a', 'gemma-a', 'gemma-4-31b-it']);
  assert.equal(r.model, 'gemma-4-31b-it');
});
test('hedged racing: a slow first model does not delay the reply; only the winner reaches the user', async () => {
  ai._resting.clear();
  const f = mockFetch({ 'gemma-g': 'hang' });
  let streamed = '';
  const t0 = Date.now();
  const r = await ai.generate({ mode: 'general', language: 'en', messages: [{ role: 'user', content: 'hi' }], fetch: f,
    timeouts: { ...fast, firstTokenTimeoutMs: 5000, hedge: 2 }, onDelta: (t) => { streamed += t; } });
  assert.ok(Date.now() - t0 < 1000, 'did not wait for the hanging model');
  assert.deepEqual(f.calls.map(c => c.model).sort(), ['gemma-g', 'gemma-or']);   // asked at once
  assert.equal(r.model, 'gemma-or');
  assert.equal(streamed, 'Answer from gemma-or');
});
test('hedged racing: when both answer, text from the loser never mixes in', async () => {
  ai._resting.clear();
  const slow = (text, ms) => new Promise(res => setTimeout(() => res(okStream(text)), ms));
  setEnv({ ...ALL, GEMINI_API_KEY: '' });   // gemma-or, qwen, deepseek: all OpenAI-compatible
  const f = async (url, init) => { const m = JSON.parse(init.body).model; return m === 'gemma-or' ? slow(
    'Answer from gemma-or', 60) : slow('Answer from ' + m, 5); };
  let streamed = '';
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f,
    timeouts: { ...fast, hedge: 2 }, onDelta: (t) => { streamed += t; } });
  assert.equal(r.model, 'qwen');
  assert.equal(streamed, 'Answer from qwen');
});
test('hedged racing: a whole wave failing moves on to the next wave', async () => {
  ai._resting.clear();
  const f = mockFetch({ 'gemma-g': 429, 'gemma-or': 429 });
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f,
    timeouts: { ...fast, hedge: 2 } });
  assert.equal(r.model, 'qwen');
  assert.equal(r.attempts.filter(a => !a.ok).length, 2);
});
test('hedged pool: a model failing fast is replaced at once, without waiting for the slow one', async () => {
  ai._resting.clear();
  const f = mockFetch({ 'gemma-g': 'hang', 'gemma-or': 404 });
  const t0 = Date.now();
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f,
    timeouts: { ...fast, firstTokenTimeoutMs: 5000, hedge: 2 } });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.model, 'qwen');
});
