// 0.11.5: the chat model's function calling on Google AI Studio's native API (modules/ai/tool-call.js through
// client.js), and a whole reply (chat/reply.js respond) when the model browses. fetch is mocked with Gemini's
// streamGenerateContent answers; no database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createParser } = require('../../src/modules/ai/sse');
const toolCall = require('../../src/modules/ai/tool-call');
const policy = require('../../src/modules/safety/policy');
const { respond } = require('../../src/modules/chat/reply');
const tools = require('../../src/modules/chat/browser-tools');

console.log = () => {};
const KEYS = ['CHAT_BROWSER_TOOLS', 'CHAT_TOOL_MODEL', 'CHAT_TOOL_FALLBACK_MODEL'];
function withEnv(t, vars) {
  const was = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  t.after(() => {
    for (const k of KEYS) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
  });
}
const routing = {
  providers: () => ({ gemini: { name: 'Google AI Studio', baseUrl: 'https://gemini.mock/v1beta', apiKey: 'k',
    native: 'gemini', thinkingLevel: 'minimal' } }),
  targets: () => ({ gemma: [{ provider: 'gemini', model: 'gemma-4-26b-a4b-it' }] }),
  routes: { general: ['gemma'], developer: ['gemma'], african: ['gemma'] }, africanLanguages: ['yo'], models: [],
};
const SSE = (parts) => new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts },
  finishReason: 'STOP' }] })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const ERR = (status) => new Response(JSON.stringify({ error: { code: status, message: 'quota' } }), { status });
const T = { firstTokenTimeoutMs: 2000, idleTimeoutMs: 2000, maxReplyMs: 4000, toolTimeoutMs: 2000 };
const CALL = { functionCall: { name: 'browse', args: { task: 'Open the colon-ai repository' } },
  thoughtSignature: 'c2lnbmF0dXJl' };
function fetcher(...answers) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return answers.shift()(); };
  fn.calls = calls;
  return fn;
}
const model = (url) => decodeURIComponent(/\/models\/([^:]+):/.exec(url)[1]);

test('tool models: gemini-3.5-flash-lite first, Gemma 4 26B when it fails; the call comes back whole', async (t) => {
  withEnv(t, {});
  assert.deepEqual(toolCall.models(), ['gemini-3.5-flash-lite', 'gemma-4-26b-a4b-it']);
  const fetch = fetcher(() => ERR(429), () => SSE([CALL]));
  const r = await toolCall.stream({ routing, fetch, timeouts: T, tools: tools.DECLS,
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go to Colon repo' }] });
  assert.deepEqual(fetch.calls.map((c) => model(c.url)), ['gemini-3.5-flash-lite', 'gemma-4-26b-a4b-it']);
  assert.match(fetch.calls[0].url, /:streamGenerateContent\?alt=sse$/);
  const body = fetch.calls[0].body;
  assert.deepEqual(body.tools[0].functionDeclarations.map((d) => d.name), ['browse', 'read_page', 'stop_browsing']);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(r.model, 'gemma-4-26b-a4b-it');
  assert.equal(r.calls[0].name, 'browse');
  assert.equal(r.calls[0].args.task, 'Open the colon-ai repository');
  assert.equal(r.calls[0].part.thoughtSignature, 'c2lnbmF0dXJl');
  assert.deepEqual(r.attempts.map((a) => a.ok), [false, true]);
  // The call goes back unchanged in the next round (raw parts pass through geminiBody).
  const next = fetcher(() => SSE([{ text: 'Done.' }]));
  await toolCall.stream({ routing, fetch: next, timeouts: T, tools: tools.DECLS, messages: [{ role: 'user',
    content: 'x' }, { role: 'assistant', parts: [CALL] }, { role: 'user', parts: [{ functionResponse: {
    name: 'read_page', response: { page: 'p' } } }] }] });
  assert.deepEqual(next.calls[0].body.contents[1], { role: 'model', parts: [CALL] });
  assert.equal(next.calls[0].body.contents[2].parts[0].functionResponse.name, 'read_page');
});

test('tool models: every one failing (or switched off) is tools_failed, for the keyword fallback', async (t) => {
  withEnv(t, { CHAT_TOOL_FALLBACK_MODEL: 'off' });
  assert.deepEqual(toolCall.models(), ['gemini-3.5-flash-lite']);
  await assert.rejects(toolCall.stream({ routing, fetch: fetcher(() => ERR(500)), timeouts: T, tools: tools.DECLS,
    messages: [{ role: 'user', content: 'hi' }] }), (e) => e.code === 'tools_failed' && e.attempts.length === 1);
  process.env.CHAT_BROWSER_TOOLS = 'off';
  assert.deepEqual(toolCall.models(), []);
  await assert.rejects(toolCall.stream({ routing, fetch: fetcher(), timeouts: T, tools: tools.DECLS,
    messages: [{ role: 'user', content: 'hi' }] }), (e) => e.code === 'tools_failed');
});

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
async function reply(text, fetch, mode = 'general') {
  const res = fakeRes();
  const saved = { dropped: false };
  const u = { id: 'u9', role: 'user', content: text };
  await respond({ req: { user: { id: 7 } }, res, mode, language: 'en', history: [{ role: 'user', content: text }],
    counters: [], routing, fetch, userText: text, searchText: text, route: 'chat.send', timeouts: T,
    db: { async query() { return []; }, async one() { return null; } }, safetySettings: policy.merge({}),
    safetyEnv: ENV,
    generate: (args) => tools.turn(args, { state: null, userMsg: u, messages: [u],
      generate: () => assert.fail('the tool model answered') }),
    store: { start: async () => ({ id: 'a1', role: 'assistant', content: '', status: 'streaming' }),
      finish: async (x) => Object.assign(saved, x), drop: async () => { saved.dropped = true; } } });
  return { ev: res.events(), saved };
}

test('a browse turn: event browse with the user message, no reply kept (the card goes under the message)',
  async (t) => {
    withEnv(t, {});
    const { ev, saved } = await reply('go to Colon repo', fetcher(() => SSE([CALL])));
    assert.deepEqual(ev.map((e) => e.event), ['start', 'browse', 'done']);
    assert.deepEqual(ev[1].data, { goal: 'Open the colon-ai repository', message_id: 'u9', how: 'tool' });
    assert.deepEqual(ev[2].data, { message: null, dropped: 'a1' });
    assert.equal(saved.dropped, true);
  });

test('an ordinary turn streams the tool model\'s text as the reply (Developer mode keeps its mode)', async (t) => {
  withEnv(t, {});
  const fetch = fetcher(() => SSE([{ text: 'It reverses the list.' }]));
  const { ev, saved } = await reply('explain this code', fetch, 'developer');
  assert.deepEqual(ev.map((e) => e.event), ['start', 'delta', 'done']);
  assert.equal(saved.content, 'It reverses the list.');
  assert.equal(saved.providerModel, 'gemini-3.5-flash-lite');
  assert.match(fetch.calls[0].body.systemInstruction.parts[0].text, /Mode: Developer\./);
});
