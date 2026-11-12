// Unit tests for the provider client and SSE: streamChat, the SSE parser, the <think> filter, the app SSE
// format and the native Google AI Studio (Gemini) mapping. fetch is mocked.
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
const { streamChat } = require('../../src/modules/ai/client');
const { createParser, thinkFilter } = require('../../src/modules/ai/sse');
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
test('streamChat: hides <think> reasoning, ignores keep-alives, handles JSON (non-stream) replies', async () => {
  const chunks = [': keep-alive\n\n', delta('<thi'), delta('nk>secret plan</th'), delta('ink>\n\nThe '),
    'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'];
  const seen = [];
  const r = await streamChat({ provider: { baseUrl: 'https://x/v1/', apiKey: 'k' }, model: 'm', messages: [],
    fetch: async (url) => { assert.equal(url, 'https://x/v1/chat/completions'); return sseResponse(chunks);
    }, onDelta: (t) => seen.push(t) });
  assert.equal(seen.join(''), 'The answer');
  assert.equal(r.finishReason, 'stop');
  const j = await streamChat({ provider: { baseUrl: 'https://x', apiKey: 'k' }, model: 'm', messages: [], fetch: async (
    ) => new Response(JSON.stringify({ choices: [{ message: { content: 'whole reply' }, finish_reason: 'stop' }] }),
    { headers: { 'content-type': 'application/json' } }) });
  assert.equal(j.text, 'whole reply');
});
test('streamChat: an error object inside the stream is a provider error', async () => {
  await assert.rejects(
    streamChat({ provider: { baseUrl: 'https://x', apiKey: 'k' }, model: 'm', messages: [], fetch: async () =>
      sseResponse(['data: {"error":{"message":"quota exceeded","code":429}}\n\n']) }),
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
  const { writer } = require('../../src/modules/ai/sse');
  let out = '';
  const res = { writableEnded: false, on() {}, write: (s) => { out += s; }, end() { this.writableEnded = true; } };
  const w = writer(res);
  w.send('start', { message: { id: 'm1' } }); w.send('delta', { text: 'Ẹ káàrọ̀\n"hi"' }); w.send('done', { message: {
    id: 'm1', status: 'complete' } }); w.end();
  const events = out.split(/\n\n/).filter(Boolean).map((block) => {
    let ev = 'message', data = '';
    block.split('\n').forEach((l) => { if (l.indexOf('event:') === 0) ev = l.slice(6).trim(); else if (l.indexOf(
      'data:') === 0) data += l.slice(5).trim(); });
    return { ev, d: JSON.parse(data) };
  });
  assert.deepEqual(events.map(e => e.ev), ['start', 'delta', 'done']);
  assert.equal(events[1].d.text, 'Ẹ káàrọ̀\n"hi"');
});
test('Google AI Studio uses the native Gemini API: system instruction, model roles, thought parts hidden', async () => {
  const f = mockFetch({ qwen: 500, deepseek: 500 });
  const r = await ai.generate({ mode: 'general', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant',
    content: 'yo' }, { role: 'user', content: 'again' }], fetch: f, timeouts: fast });
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
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'How far!' }] },
      finishReason: 'STOP' }] })}\n\n`,
  ]);
  const res = await streamChat({ fetch: async () => thought, provider: { baseUrl: 'https://x/v1beta', apiKey: 'k',
    native: 'gemini' }, model: 'gemma-4-31b-it', messages: [{ role: 'user', content: 'x' }], onDelta: (t) => { out +=
    t; } });
  assert.equal(out, 'How far!');
  assert.equal(res.finishReason, 'stop');
});
