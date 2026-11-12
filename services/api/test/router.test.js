// Unit tests for model router v1 (services/api/src/ai): routing table, language routing, automatic
// fallback, SSE parsing and the provider client. fetch is mocked: no network, no keys, no database.
const test = require('node:test');
const assert = require('node:assert/strict');

const KEYS = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'NATLAS_API_KEY', 'NATLAS_BASE_URL', 'GROQ_MODEL', 'OPENROUTER_DEEPSEEK_MODEL', 'OPENROUTER_GEMMA_MODEL', 'GEMINI_MODEL', 'NATLAS_MODEL', 'GEMINI_FALLBACK_MODEL', 'NVIDIA_API_KEY'];
function setEnv(vals) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vals);
}
const ALL = {
  GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o', GEMINI_API_KEY: 'm', NATLAS_API_KEY: 'n', NATLAS_BASE_URL: 'https://natlas.example/v1',
  GROQ_MODEL: 'qwen', OPENROUTER_DEEPSEEK_MODEL: 'deepseek', OPENROUTER_GEMMA_MODEL: 'gemma-or', GEMINI_MODEL: 'gemma-g', NATLAS_MODEL: 'natlas', GEMINI_FALLBACK_MODEL: 'off',
};

const ai = require('../src/ai');
const { streamChat } = require('../src/ai/client');
const { createParser, thinkFilter } = require('../src/ai/sse');

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
const errResponse = (status) => new Response(JSON.stringify({ error: { message: `status ${status}` } }), { status, headers: { 'content-type': 'application/json' } });

// fetch mock: behaviour per model id; records the order of models called.
function mockFetch(behaviour) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    // Google AI Studio's native API carries the model in the URL, not the body.
    const native = /:streamGenerateContent/.exec(url) ? decodeURIComponent(url.split('/models/')[1].split(':')[0]) : null;
    const model = native || body.model;
    calls.push({ url, model, auth: init.headers.Authorization || init.headers['x-goog-api-key'], body, native: Boolean(native) });
    const b = behaviour[model] || 'ok';
    if (typeof b === 'number') return errResponse(b);
    if (b === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (b === 'hang-stream') return sseResponse([], { hang: true });
    if (b === 'drop') return sseResponse([delta('Partial '), delta('answer ')], { breakAfter: 2 });
    if (b === 'network') throw new TypeError('fetch failed');
    if (native) return sseResponse(`Answer from ${model}`.split(/(?<= )/).map(t => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`));
    return okStream(`Answer from ${model}`);
  };
  fn.calls = calls;
  return fn;
}
const order = (chain) => chain.map(c => `${c.providerId}:${c.model}`);
const fast = { firstTokenTimeoutMs: 80, idleTimeoutMs: 200, maxReplyMs: 2000, hedge: 1 };

test.beforeEach(() => { ai._resting.clear(); setEnv(ALL); });

test('language routing (bench 2026-11-12): Pidgin, Yorùbá, Hausa and Igbo go Gemma 4 → N-ATLaS → Qwen → DeepSeek', () => {
  for (const lang of ['pcm', 'yo', 'ha', 'ig']) {
    for (const mode of ['general', 'developer', 'study', 'research']) {
      assert.deepEqual(order(ai.chainFor({ mode, language: lang })),
        ['gemini:gemma-g', 'openrouter:gemma-or', 'natlas:natlas', 'groq:qwen', 'openrouter:deepseek'], `${lang}/${mode}`);
    }
  }
});

test('mode routing for English (bench 2026-11-12): every mode → Gemma 4 26B first, DeepSeek last', () => {
  for (const mode of ['general', 'study', 'research', 'developer']) {
    assert.deepEqual(order(ai.chainFor({ mode, language: 'en' })), ['gemini:gemma-g', 'openrouter:gemma-or', 'groq:qwen', 'openrouter:deepseek']);
  }
  setEnv({ ...ALL, NVIDIA_API_KEY: 'v', GEMINI_FALLBACK_MODEL: 'gemma-31' });
  assert.deepEqual(order(ai.chainFor({ mode: 'general', language: 'en' })).filter(x => !x.startsWith('openrouter') && !x.startsWith('groq')),
    ['gemini:gemma-g', 'nvidia:minimaxai/minimax-m3.1-flash', 'gemini:gemma-31', 'nvidia:deepseek-ai/deepseek-v4.1-flash', 'nvidia:z-ai/glm-5.3-flash']);
  assert.deepEqual(order(ai.chainFor({ mode: 'general', language: 'yo' })).filter(x => !x.startsWith('openrouter') && !x.startsWith('groq')),
    ['gemini:gemma-g', 'gemini:gemma-31', 'natlas:natlas', 'nvidia:minimaxai/minimax-m3.1-flash', 'nvidia:deepseek-ai/deepseek-v4.1-flash', 'nvidia:z-ai/glm-5.3-flash']);
  delete process.env.NVIDIA_API_KEY;
  setEnv(ALL);
  assert.deepEqual(order(ai.chainFor({ mode: 'nonsense' })), order(ai.chainFor({ mode: 'general' })));
});

test('providers are enabled only when their key is set (N-ATLaS also needs a base URL)', () => {
  setEnv({ GROQ_API_KEY: 'g', GROQ_MODEL: 'qwen', NATLAS_API_KEY: 'n' }); // no NATLAS_BASE_URL
  assert.deepEqual(Object.keys(ai.enabledProviders()), ['groq']);
  assert.deepEqual(order(ai.chainFor({ mode: 'developer', language: 'yo' })), ['groq:qwen']);
  setEnv({});
  assert.equal(ai.isConfigured(), false);
  assert.ok(ai.listModels().every(m => !m.available));
  assert.equal(ai.listModels().find(m => m.default).status, 'unavailable');
});

test('model ids are env-overridable and images only go to vision-capable targets', () => {
  setEnv({ ...ALL, GEMINI_MODEL: 'gemma-4-26b-a4b-it' });
  const chain = ai.chainFor({ mode: 'general', needsVision: true });
  assert.deepEqual(order(chain), ['gemini:gemma-4-26b-a4b-it', 'openrouter:gemma-or']);
  assert.ok(ai.listModels().find(m => m.id === 'colon-saga').capabilities.includes('vision'));
});

test('Saga Fast has its own chain, but African languages still win', () => {
  assert.deepEqual(order(ai.chainFor({ mode: 'developer', model: 'colon-saga-fast' })), ['gemini:gemma-g', 'openrouter:gemma-or', 'groq:qwen', 'openrouter:deepseek']);
  assert.ok(order(ai.chainFor({ mode: 'developer', language: 'ha', model: 'colon-saga-fast' })).includes('natlas:natlas'));
});

test('fallback on 429 before the first token, in routing order', async () => {
  const f = mockFetch({ 'gemma-g': 429, 'gemma-or': 429 });
  let streamed = '';
  const r = await ai.generate({ mode: 'general', language: 'en', messages: [{ role: 'user', content: 'hi' }], fetch: f, timeouts: fast, onDelta: (t) => { streamed += t; } });
  assert.deepEqual(f.calls.map(c => c.model), ['gemma-g', 'gemma-or', 'qwen']);
  assert.equal(r.providerId, 'groq');
  assert.equal(r.model, 'qwen');
  assert.equal(r.text, 'Answer from qwen');
  assert.equal(streamed, r.text);
  assert.equal(r.attempts[0].code, 'rate_limited');
  assert.equal(f.calls[0].auth, 'm');
  assert.equal(f.calls[2].auth, 'Bearer g');
  assert.equal(f.calls[2].body.messages[0].role, 'system');
  assert.equal(f.calls[2].body.stream, true);
});

test('fallback on 5xx, 404 (missing free model), network error and first-token timeout', async () => {
  const f = mockFetch({ 'gemma-g': 404, 'gemma-or': 500, natlas: 'network', qwen: 'hang' });
  const r = await ai.generate({ mode: 'general', language: 'pcm', messages: [{ role: 'user', content: 'how far' }], fetch: f, timeouts: fast });
  // a quick 5xx is retried once on the same model (Google's free tier throws random 500s)
  assert.deepEqual(f.calls.map(c => c.model), ['gemma-g', 'gemma-or', 'gemma-or', 'natlas', 'qwen', 'deepseek']);
  assert.equal(r.model, 'deepseek');
  assert.deepEqual(r.attempts.map(a => a.code), ['model_not_found', 'upstream_error', 'upstream_error', 'network', 'timeout', undefined]);
});

test('a provider whose stream never starts (headers but no tokens) times out and falls back', async () => {
  const f = mockFetch({ 'gemma-or': 'hang-stream', 'gemma-g': 404 });
  const r = await ai.generate({ mode: 'study', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: fast });
  assert.equal(r.model, 'qwen');
});

test('killing the primary: a failed target rests and is tried last next time', async () => {
  const f = mockFetch({ 'gemma-g': 429 });
  await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: fast });
  assert.deepEqual(order(ai.chainFor({ mode: 'general' })), ['openrouter:gemma-or', 'groq:qwen', 'openrouter:deepseek', 'gemini:gemma-g']);
});

test('no silent model switch after the first token: the error keeps the partial text', async () => {
  setEnv({ ...ALL, GEMINI_API_KEY: '' });
  const f = mockFetch({ 'gemma-or': 'drop' });
  await assert.rejects(
    ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: fast }),
    (e) => e.code === 'provider_down' && e.partial === true && e.partialText === 'Partial answer ',
  );
  assert.deepEqual(f.calls.map(c => c.model), ['gemma-or']);
});

test('every provider failing gives provider_down; no keys gives no_provider; images without vision give no_vision', async () => {
  const f = mockFetch({ qwen: 500, deepseek: 429, 'gemma-g': 503, 'gemma-or': 500 });
  await assert.rejects(ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: fast }), (e) => e.code === 'provider_down' && !e.partial);
  setEnv({});
  await assert.rejects(ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f }), (e) => e.code === 'no_provider');
  setEnv({ GROQ_API_KEY: 'g', GROQ_MODEL: 'qwen' });
  const img = [{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }];
  await assert.rejects(ai.generate({ mode: 'general', messages: img, fetch: f }), (e) => e.code === 'no_vision');
});

test('Stop (abort) ends the call without fallback and reports the partial text', async () => {
  const ctl = new AbortController();
  const f = async (url, init) => sseResponse([delta('Hello '), delta('there ')], { hang: true });
  const p = ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, signal: ctl.signal, timeouts: { ...fast, idleTimeoutMs: 5000 }, onDelta: () => setTimeout(() => ctl.abort(), 5) });
  await assert.rejects(p, (e) => e.name === 'AbortError' && e.partialText.startsWith('Hello'));
});

test('streamChat: hides <think> reasoning, ignores keep-alives, handles JSON (non-stream) replies', async () => {
  const chunks = [': keep-alive\n\n', delta('<thi'), delta('nk>secret plan</th'), delta('ink>\n\nThe '), 'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'];
  const seen = [];
  const r = await streamChat({ provider: { baseUrl: 'https://x/v1/', apiKey: 'k' }, model: 'm', messages: [], fetch: async (url) => { assert.equal(url, 'https://x/v1/chat/completions'); return sseResponse(chunks); }, onDelta: (t) => seen.push(t) });
  assert.equal(seen.join(''), 'The answer');
  assert.equal(r.finishReason, 'stop');
  const j = await streamChat({ provider: { baseUrl: 'https://x', apiKey: 'k' }, model: 'm', messages: [], fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'whole reply' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }) });
  assert.equal(j.text, 'whole reply');
});

test('streamChat: an error object inside the stream is a provider error', async () => {
  await assert.rejects(
    streamChat({ provider: { baseUrl: 'https://x', apiKey: 'k' }, model: 'm', messages: [], fetch: async () => sseResponse(['data: {"error":{"message":"quota exceeded","code":429}}\n\n']) }),
    (e) => e.name === 'ProviderError' && e.code === 'rate_limited' && /quota/.test(e.message),
  );
});

test('SSE parser: split chunks, CRLF, comments, multi-line data, events', () => {
  const got = [];
  const p = createParser((e) => got.push(e));
  p.push('data: {"a"'); p.push(':1}\r\n\r'); p.push('\n: comment\n\nevent: delta\ndata: line1\ndata: line2\n\n');
  p.push('data: [DONE]');
  p.end();
  assert.deepEqual(got, [
    { event: 'message', data: '{"a":1}' },
    { event: 'delta', data: 'line1\nline2' },
    { event: 'message', data: '[DONE]' },
  ]);
});

test('think filter: tags split across chunks, text before and after kept', () => {
  const f = thinkFilter();
  const out = ['Hi <', 'think', '>x</', 'think> there <', 'b>'].map(s => f.push(s)).join('') + f.flush();
  assert.equal(out, 'Hi there <b>');
});

test('the app SSE format round-trips through the same parser the browser uses', () => {
  // chat-data.js splits on blank lines and reads "event:" and "data:" lines; mirror that here.
  const { writer } = require('../src/ai/sse');
  let out = '';
  const res = { writableEnded: false, on() {}, write: (s) => { out += s; }, end() { this.writableEnded = true; } };
  const w = writer(res);
  w.send('start', { message: { id: 'm1' } }); w.send('delta', { text: 'Ẹ káàrọ̀\n"hi"' }); w.send('done', { message: { id: 'm1', status: 'complete' } }); w.end();
  const events = out.split(/\n\n/).filter(Boolean).map((block) => {
    let ev = 'message', data = '';
    block.split('\n').forEach((l) => { if (l.indexOf('event:') === 0) ev = l.slice(6).trim(); else if (l.indexOf('data:') === 0) data += l.slice(5).trim(); });
    return { ev, d: JSON.parse(data) };
  });
  assert.deepEqual(events.map(e => e.ev), ['start', 'delta', 'done']);
  assert.equal(events[1].d.text, 'Ẹ káàrọ̀\n"hi"');
});

test('Google AI Studio uses the native Gemini API: system instruction, model roles, thought parts hidden', async () => {
  const f = mockFetch({ qwen: 500, deepseek: 500 });
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'again' }], fetch: f, timeouts: fast });
  assert.equal(r.providerId, 'gemini');
  assert.equal(r.text, 'Answer from gemma-g');
  const call = f.calls.find(c => c.native);
  assert.match(call.url, /\/models\/gemma-g:streamGenerateContent\?alt=sse$/);
  assert.equal(call.auth, 'm');
  assert.ok(call.body.systemInstruction.parts[0].text.length > 0);
  assert.deepEqual(call.body.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.equal(call.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  let out = '';
  const thought = sseResponse([
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'secret plan', thought: true }] } }] })}\n\n`,
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'How far!' }] }, finishReason: 'STOP' }] })}\n\n`,
  ]);
  const res = await streamChat({ fetch: async () => thought, provider: { baseUrl: 'https://x/v1beta', apiKey: 'k', native: 'gemini' }, model: 'gemma-4-31b-it', messages: [{ role: 'user', content: 'x' }], onDelta: (t) => { out += t; } });
  assert.equal(out, 'How far!');
  assert.equal(res.finishReason, 'stop');
});

test('a second Google Gemma model backs up the first', async () => {
  setEnv({ GEMINI_API_KEY: 'm', GEMINI_MODEL: 'gemma-a' });
  const f = mockFetch({ 'gemma-a': 500 });
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: fast });
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
  const f = async (url, init) => { const m = JSON.parse(init.body).model; return m === 'gemma-or' ? slow('Answer from gemma-or', 60) : slow('Answer from ' + m, 5); };
  let streamed = '';
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: { ...fast, hedge: 2 }, onDelta: (t) => { streamed += t; } });
  assert.equal(r.model, 'qwen');
  assert.equal(streamed, 'Answer from qwen');
});

test('hedged racing: a whole wave failing moves on to the next wave', async () => {
  ai._resting.clear();
  const f = mockFetch({ 'gemma-g': 429, 'gemma-or': 429 });
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: { ...fast, hedge: 2 } });
  assert.equal(r.model, 'qwen');
  assert.equal(r.attempts.filter(a => !a.ok).length, 2);
});

test('hedged pool: a model failing fast is replaced at once, without waiting for the slow one', async () => {
  ai._resting.clear();
  const f = mockFetch({ 'gemma-g': 'hang', 'gemma-or': 404 });
  const t0 = Date.now();
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'x' }], fetch: f, timeouts: { ...fast, firstTokenTimeoutMs: 5000, hedge: 2 } });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.model, 'qwen');
});
