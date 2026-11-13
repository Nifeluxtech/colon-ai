// Unit tests for the v0.5.6 benchmark rerun fixes, all against the mock provider (no network): the retry policy
// (Retry-After, back-off, no retry on 400/404), the per-provider limiter (RPM and in-flight caps), structured error
// reasons (stall phase), resume from checkpoint (settings fingerprint, --retry-errors), the fatal stop, per-model
// request options (Nemotron, Mistral, GLM bodies) and the probe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const runner = require('../../src/modules/bench/runner');
const retry = require('../../src/modules/bench/retry');
const { createLimiter } = require('../../src/modules/bench/limiter');
const ckpt = require('../../src/modules/bench/checkpoint');
const cands = require('../../src/modules/bench/candidates');
const { probe } = require('../../src/modules/bench/probe');
const { streamChat, retryAfter } = require('../../src/modules/ai/client');
const routing = require('../../src/modules/ai/routing');

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json', ...headers } });
const sse = (events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n',
  { headers: { 'content-type': 'text/event-stream' } });
const answer = (text, finish = 'stop') => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {},
  finish_reason: finish }] }]);
const mock = { mock: { baseUrl: 'http://mock.local/v1', apiKey: 'k' } };
const realProviders = routing.providers;
const withMock = async (fn) => {
  routing.providers = () => ({ ...realProviders(), ...mock });
  try { await fn(); } finally { routing.providers = realProviders; }
};
const waecItem = () => runner.loadSets(runner.SETS_DIR, ['waec'])[0].items[0];   // expects "Answer: 6"
const noSleep = { sleep: async () => {}, jitter: 0 };

test('retry: honours Retry-After, backs off exponentially, never retries 400/401/404', () => {
  const o = { jitter: 0 };
  assert.equal(retryAfter('7'), 7000);
  assert.equal(retryAfter('Thu, 01 Jan 2099 00:00:10 GMT', Date.parse('Thu, 01 Jan 2099 00:00:00 GMT')), 10000);
  assert.equal(retryAfter(null), null);
  assert.deepEqual(retry.nextWait({ code: 'rate_limited', retryAfterMs: 5000 }, { errors: 0, limited: 0 }, o),
    { retry: true, rate: true, waitMs: 5000 });
  assert.equal(retry.nextWait({ code: 'rate_limited' }, { errors: 0, limited: 1 }, o).waitMs, 40000);
  assert.equal(retry.nextWait({ code: 'rate_limited' }, { errors: 0, limited: 6 }, o).retry, false);
  assert.equal(retry.nextWait({ code: 'upstream_error' }, { errors: 1, limited: 0 }, o).waitMs, 30000);
  assert.equal(retry.nextWait({ code: 'timeout' }, { errors: 2, limited: 0 }, o).retry, false, 'two retries max');
  for (const code of ['http_400', 'auth', 'model_not_found']) {
    assert.equal(retry.nextWait({ code }, { errors: 0, limited: 0 }, o).retry, false, code);
  }
  const w = retry.nextWait({ code: 'upstream_error' }, { errors: 0, limited: 0 }, { jitter: 0.2, random: () => 1 });
  assert.equal(w.waitMs, 12000, 'jitter ±20 %');
  assert.match(retry.reason({ code: 'http_400', status: 400, message: 'unknown field reasoning_budget' }),
    /http_400 400: unknown field reasoning_budget \[bad request: a parameter this model does not accept\?\]/);
});

test('limiter: caps requests per minute and in flight, in arrival order', async () => {
  let t = 0;
  const slept = [];
  const rpm = createLimiter({ rpm: 2, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  for (let i = 0; i < 3; i++) (await rpm.acquire())();
  assert.deepEqual(slept, [60005], 'the third start waits for the first to leave the rolling minute');
  const inflight = createLimiter({ concurrency: 1 });
  const order = [];
  const r1 = await inflight.acquire();
  const p2 = inflight.acquire().then((rel) => { order.push('second'); rel(); });
  await new Promise(r => setTimeout(r, 5));
  order.push('first done');
  r1();
  await p2;
  assert.deepEqual(order, ['first done', 'second']);
});

test('runItem: a 429 with Retry-After is waited out and recorded; the limiter is used for every attempt', async () => {
  await withMock(async () => {
    let n = 0, acquired = 0;
    const fetch = async () => (n++ < 2 ? json(429, { error: { message: 'slow down' } }, { 'retry-after': '3' })
      : answer('Answer: 6'));
    const waits = [];
    const limiter = { acquire: async () => { acquired++; return () => {}; } };
    const row = await runner.runItem({ provider: 'mock', model: 'm' }, waecItem(), { fetch, limiter, retries: 0,
      jitter: 0, sleep: async (ms) => { waits.push(ms); } });
    assert.equal(row.pass, true);
    assert.deepEqual(waits, [3000, 3000]);
    assert.equal(row.attempts, 3);
    assert.equal(row.waited_ms, 6000);
    assert.equal(acquired, 3);
    assert.deepEqual(row.attempt_log.map(a => a.status), [429, 429]);
  });
});

test('runItem: error rows say where the model stalled (no headers vs open stream)', async () => {
  await withMock(async () => {
    const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(
      new Error('aborted'))));
    const row = await runner.runItem({ provider: 'mock', model: 'm' }, waecItem(), { fetch: hang, retries: 1,
      firstTokenTimeoutMs: 30, ...noSleep });
    assert.equal(row.error_code, 'timeout');
    assert.equal(row.error_phase, 'connect');
    assert.equal(row.attempts, 2);
    assert.match(row.error, /timeout \(no response from the host \(queued or overloaded\)\)/);
    // Headers arrive, then only reasoning chunks and silence: phase first_token / idle with a reasoning count.
    const thinking = async (url, init) => new Response(new ReadableStream({ start(ctl) {
      ctl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hm' }
      }] })}\n\n`));
      init.signal.addEventListener('abort', () => ctl.error(new Error('aborted')));
    } }), { headers: { 'content-type': 'text/event-stream' } });
    const r2 = await runner.runItem({ provider: 'mock', model: 'm' }, waecItem(), { fetch: thinking, retries: 0,
      firstTokenTimeoutMs: 30, idleTimeoutMs: 30, ...noSleep });
    assert.equal(r2.error_phase, 'idle');
    assert.match(r2.error, /1 reasoning chunks/);
  });
});

test('runItem: an answer cut at max_tokens says so instead of "got null"', async () => {
  await withMock(async () => {
    const row = await runner.runItem({ provider: 'mock', model: 'm' }, waecItem(), { fetch: async () => answer(
      'Let me think', 'length'), maxTokens: 64, ...noSleep });
    assert.equal(row.finish, 'length');
    assert.match(row.detail, /^cut off at max_tokens \(64\)/);
  });
});

test('runModel: stops at once on a wrong key or model id (fatal), not after 20 items', async () => {
  await withMock(async () => {
    const items = runner.loadSets().flatMap(s => s.items).slice(0, 10);
    let calls = 0;
    const r = await runner.runModel({ provider: 'mock', model: 'gone' }, items, { fetch: async () => { calls++;
      return json(404, { error: { message: 'Function not found' } }); }, ...noSleep });
    assert.equal(r.rows.length, 1);
    assert.equal(calls, 1);
    assert.match(r.fatal, /model_not_found 404: Function not found \[model id not on this host\]/);
  });
});

test('candidates: request bodies and options per model, same body as routing for routed models', async () => {
  const c = (m) => cands.parseCandidate(`nvidia:${m}`);
  assert.deepEqual(cands.bodyOf(c('z-ai/glm-5.3-flash')), { reasoning_effort: 'low' });
  assert.deepEqual(cands.bodyOf(c('deepseek-ai/deepseek-v4.1-flash')), { chat_template_kwargs: { thinking: false } });
  assert.deepEqual(cands.bodyOf(c('mistralai/mistral-large-4-1t-a52b')), { reasoning_effort: 'low' });
  const nemo = c('nvidia/nemotron-3.5-lightning-30b-a3b');
  assert.deepEqual(cands.bodyOf(nemo), { reasoning_budget: 1024 });
  assert.equal(nemo.opts.maxTokens, 4096);
  process.env.NVIDIA_GLM_REASONING = 'default';
  try { assert.equal(cands.bodyOf(c('z-ai/glm-5.3-flash')), null); } finally {
    delete process.env.NVIDIA_GLM_REASONING; }
  await withMock(async () => {
    let sent;
    const fetch = async (url, init) => { sent = JSON.parse(init.body); return answer('Answer: 6'); };
    const row = await runner.runItem({ provider: 'mock', model: 'n', body: { reasoning_budget: 1024 },
      opts: { maxTokens: 4096 } }, waecItem(), { fetch, maxTokens: 2048, ...noSleep });
    assert.equal(sent.max_tokens, 4096, "a model's own options win over the run default");
    assert.equal(sent.reasoning_budget, 1024);
    assert.equal(row.cfg, cands.cfgOf({ provider: 'mock', model: 'n', body: { reasoning_budget: 1024 },
      opts: { maxTokens: 4096 } }));
  });
  assert.notEqual(cands.cfgOf(nemo), cands.cfgOf({ ...nemo, opts: { maxTokens: 2048 } }));
});

test('checkpoint: resume keeps answered items, re-asks errors on request and rows with other settings', () => {
  const rows = [
    { id: 'a', score: 1 }, { id: 'b', error: 'timeout: x', error_code: 'timeout', cfg: 'new' },
    { id: 'c', score: 0, cfg: 'old' }, { id: 'd', error: 'rate_limited 429: y' }, { id: 'a', score: 0, cfg: 'new' },
  ];
  const keep = ckpt.plan(rows, { cfg: 'new' });
  assert.deepEqual([...keep.done].sort(), ['a', 'b', 'd']);
  assert.equal(keep.stale, 1, 'c was answered with other settings');
  assert.equal(keep.prior.find(r => r.id === 'a').score, 0, 'latest row per item');
  assert.deepEqual([...ckpt.plan(rows, { cfg: 'new', retryErrors: true }).done].sort(), ['a']);
  assert.deepEqual([...ckpt.plan(rows, { cfg: 'new', retryErrors: 'rate_limited' }).done].sort(), ['a', 'b']);
  assert.deepEqual(ckpt.reportRows(rows, 'new').map(r => r.id), ['b', 'd', 'a']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ckpt-'));
  try {
    const f = path.join(dir, 'runs', 'r1', 'm.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'r1', 'meta.json'), '{}');
    fs.writeFileSync(f, '{"id":"a","score":1}\n{"id":"b","sco');      // last line cut by a kill
    assert.equal(ckpt.readJsonl(f).length, 1);
    ckpt.writeStatus(f, { state: 'unreliable' });
    assert.equal(ckpt.readStatus(f).unreliable, true);
    ckpt.writeStatus(f, { state: 'stopped', reason: 'SIGTERM' });
    assert.equal(ckpt.readStatus(f).unreliable, undefined);
    assert.equal(ckpt.latestRun(dir), 'r1');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('probe: reports headers, reasoning and answer times, or the error reason', async () => {
  const providerConfig = () => mock.mock;
  const ok = await probe({ provider: 'mock', model: 'm' }, { providerConfig, fetch: async () => sse([
    { choices: [{ delta: { reasoning_content: 'hmm' } }] }, { choices: [{ delta: { content: 'ok' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] }]) });
  assert.equal(ok.ok, true);
  assert.equal(ok.finish, 'stop');
  assert.ok(ok.headers_ms !== null && ok.first_reasoning_ms !== null && ok.first_token_ms !== null);
  const bad = await probe({ provider: 'mock', model: 'm' }, { providerConfig, fetch: async () => json(400,
    { error: { message: 'Unsupported parameter: reasoning_effort' } }) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /http_400 400: Unsupported parameter/);
  await assert.rejects(streamChat({ provider: mock.mock, model: 'm', messages: [], fetch: async () => json(503,
    { error: { message: 'busy' } }, { 'retry-after': '2' }) }), (e) => e.code === 'upstream_error'
    && e.retryAfterMs === 2000);
});
