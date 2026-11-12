// Unit tests for the Colon benchmark runner (Phase 5): aggregation and the score formula, ranking, the runner
// against a mock provider (retries, 429 waits, the unreliable stop), the report and the model-change gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const { aggregate, rank, quantile, speedScore } = require('../../src/modules/bench/aggregate');
const runner = require('../../src/modules/bench/runner');
const report = require('../../src/modules/bench/report');
const gate = require('../../src/modules/bench/gate');
/* ---------- aggregation and score ---------- */
test('aggregate: per-set accuracy, errors count as 0, latency quantiles and the weighted score', () => {
  assert.equal(quantile([5, 1, 3], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(speedScore(800), 1);
  assert.equal(speedScore(20000), 0);
  assert.ok(Math.abs(speedScore(Math.sqrt(1000 * 20000)) - 0.5) < 1e-9);
  const rows = [
    { set: 'waec', id: 'a', pass: true, score: 1, first_token_ms: 1000, total_ms: 2000 },
    { set: 'waec', id: 'b', pass: false, score: 0, first_token_ms: 1000, total_ms: 2000 },
    { set: 'yoruba', id: 'c', pass: true, score: 1, lang: 0.8, first_token_ms: 1000, total_ms: 2000 },
    { set: 'yoruba', id: 'd', pass: false, score: 0, lang: null, error: 'timeout: slow', first_token_ms: null,
      total_ms: 60000 },
  ];
  const a = aggregate(rows);
  assert.equal(a.sets.waec.accuracy, 0.5);
  assert.equal(a.sets.yoruba.accuracy, 0.5);
  assert.equal(a.sets.yoruba.errors, 1);
  assert.equal(a.overall.error_rate, 0.25);
  assert.equal(a.overall.first_token_ms.median, 1000);
  assert.equal(a.components.language, 0.8);
  // 100 × (0.6×0.5 + 0.15×0.8 + 0.10×1 + 0.15×0.75) = 63.25
  assert.equal(a.score, 63.3);
  const judged = aggregate(rows.map(r => (r.id === 'c' ? { ...r, judge: 0.4 } : r)));
  assert.equal(judged.components.language, 0.6, 'judge blended 50/50 with the automatic language score');
});
test('rank: score first, then cost, then speed', () => {
  const m = (key, score, ft, cost = 0) => ({ key, score, overall: { cost_usd: cost, first_token_ms: { median: ft } } });
  assert.deepEqual(rank([m('slow', 80, 9000), m('best', 90, 9000), m('fast', 80, 1000)]).map(x => x.key), ['best',
    'fast', 'slow']);
  assert.deepEqual(rank([m('paid', 80, 1000, 2), m('free', 80, 5000, 0)]).map(x => x.key), ['free', 'paid']);
});
/* ---------- runner against a mock provider (no network) ---------- */
function sseFetch(answer, { status = 200, failTimes = 0 } = {}) {
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (n++ < failTimes) return new Response('{"error":{"message":"busy"}}', { status: 503, headers: { 'content-type':
      'application/json' } });
    if (status !== 200) return new Response('{"error":{"message":"nope"}}', { status, headers: { 'content-type':
      'application/json' } });
    const text = typeof answer === 'function' ? answer(JSON.parse(init.body)) : answer;
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, calls };
}
const mockProvider = { mock: { baseUrl: 'http://mock.local/v1', apiKey: 'k' } };
const routing = require('../../src/modules/ai/routing');
const realProviders = routing.providers;
test('runner: grades a reply, sends Saga\'s system prompt for the item\'s mode and language, records timing',
  async () => {
  routing.providers = () => ({ ...realProviders(), ...mockProvider });
  try {
    const items = runner.loadSets(runner.SETS_DIR, ['waec']).flatMap(s => s.items).slice(0, 2);
    const { fetch, calls } = sseFetch('Answer: 6');
    const row = await runner.runItem({ provider: 'mock', model: 'm1' }, items[0], { fetch, backoffMs: [1] });
    assert.equal(row.pass, true);
    assert.equal(row.id, 'waec-01');
    assert.ok(row.first_token_ms >= 0 && row.total_ms >= row.first_token_ms);
    assert.match(calls[0].body.messages[0].content, /Mode: Study/);
    assert.match(calls[0].body.messages[1].content, /Answer: <number>/);
    const yo = runner.loadSets(runner.SETS_DIR, ['yoruba'])[0].items[0];
    await runner.runItem({ provider: 'mock', model: 'm1' }, yo, { fetch, backoffMs: [1] });
    assert.match(calls[1].body.messages[0].content, /Reply language: Yorùbá/);
  } finally { routing.providers = realProviders; }
});
test('runner: retries a busy host politely, then records an error row', async () => {
  routing.providers = () => ({ ...realProviders(), ...mockProvider });
  try {
    const item = runner.loadSets(runner.SETS_DIR, ['waec'])[0].items[0];
    const flaky = sseFetch('Answer: 6', { failTimes: 1 });
    const ok = await runner.runItem({ provider: 'mock', model: 'm' }, item, { fetch: flaky.fetch, backoffMs: [1] });
    assert.equal(ok.pass, true);
    assert.equal(ok.attempts, 2);
    const dead = sseFetch('', { status: 503 });
    const bad = await runner.runItem({ provider: 'mock', model: 'm' }, item, { fetch: dead.fetch, retries: 2,
      backoffMs: [1] });
    assert.equal(bad.pass, false);
    assert.match(bad.error, /upstream_error 503/);
    assert.equal(dead.calls.length, 3);
    let calls429 = 0;
    const limited = async (url, init) => (calls429++ < 3 ? new Response('{"error":{"message":"slow down"}}',
      { status: 429, headers: { 'content-type': 'application/json' } }) : flaky.fetch(url, init));
    const patient = await runner.runItem({ provider: 'mock', model: 'm' }, item, { fetch: limited, retries: 0,
      backoffMs: [1], rateBackoffMs: [1] });
    assert.equal(patient.pass, true, '429s are waited out without using the normal retries');
        const missing = sseFetch('', { status: 404 });
    await runner.runItem({ provider: 'mock', model: 'm' }, item, { fetch: missing.fetch, retries: 2, backoffMs: [1] });
    assert.equal(missing.calls.length, 1, 'a 404 is not retried');
  } finally { routing.providers = realProviders; }
});
test('runner: stops a model as unreliable when >50% of its first 20 items error', async () => {
  routing.providers = () => ({ ...realProviders(), ...mockProvider });
  try {
    const items = runner.loadSets().flatMap(s => s.items).slice(0, 40);
    const dead = sseFetch('', { status: 500 });
    const r = await runner.runModel({ provider: 'mock', model: 'm' }, items, { fetch: dead.fetch, retries: 0,
      backoffMs: [1] });
    assert.equal(r.unreliable, true);
    assert.equal(r.rows.length, 20);
    const good = sseFetch('B');
    const r2 = await runner.runModel({ provider: 'mock', model: 'm' }, items.slice(0, 5), { fetch: good.fetch,
      done: new Set([items[0].id]) });
    assert.equal(r2.rows.length, 4, 'finished items are skipped on resume');
  } finally { routing.providers = realProviders; }
});
test('sandboxFetch drops only the key headers (bench runner in the sandbox)', async () => {
  let seen;
  const f = runner.sandboxFetch(async (url, init) => { seen = init.headers; return new Response('{}'); });
  await f('https://x', { headers: { Authorization: 'Bearer k', 'x-goog-api-key': 'k',
    'Content-Type': 'application/json' } });
  assert.deepEqual(seen, { 'Content-Type': 'application/json' });
});
test('regrade re-scores a saved reply with the current graders', () => {
  const item = runner.loadSets(runner.SETS_DIR, ['waec'])[0].items[0];
  const row = runner.regrade({ set: 'waec', id: item.id, pass: false, score: 0, reply: 'Answer: 6' }, item);
  assert.equal(row.pass, true);
});
/* ---------- report and eval_runs rows ---------- */
test('report: ranks finished models first, Markdown scoreboard and eval_runs rows', () => {
  const rows = (score) => [{ set: 'waec', id: 'w1', pass: score === 1, score, first_token_ms: 900, total_ms: 1000 }];
  const rep = report.buildReport({ run: 't', suite: 'colon-bench-1', started: '2026-11-12T00:00:00Z',
    finished: '2026-11-12T01:00:00Z', models: [
    { provider: 'nvidia', model: 'weak', rows: rows(0), expected: 1 },
    { provider: 'gemini', model: 'strong', rows: rows(1), expected: 1 },
    { provider: 'nvidia', model: 'flaky', rows: rows(1), expected: 1, unreliable: true },
  ] });
  assert.deepEqual(rep.ranking, ['gemini:strong', 'nvidia:weak', 'nvidia:flaky']);
  const md = report.markdown(rep);
  assert.match(md, /\| 1 \| gemini:strong \|/);
  assert.match(md, /nvidia:flaky \(unreliable\)/);
  const ev = report.evalRows(rep);
  assert.equal(ev.length, 3);
  assert.equal(ev[0].kind, 'bench');
  assert.equal(ev[2].status, 'failed');
  assert.equal(ev[0].created_at.toISOString(), '2026-11-12T01:00:00.000Z');
});
/* ---------- gate ---------- */
test('gate: a model change needs a finished benchmark of that exact model, newer than the age limit', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const run = (over) => ({ provider: 'nvidia', model: 'z-ai/glm-5.3-flash', kind: 'bench', status: 'done',
    created_at: '2026-11-10T00:00:00Z', ...over });
  const m = { provider: 'nvidia', model: 'z-ai/glm-5.3-flash' };
  assert.equal(gate.check(m, [], { now }).ok, false);
  assert.equal(gate.check(m, [run()], { now }).ok, true);
  assert.equal(gate.check(m, [run({ status: 'failed' })], { now }).ok, false, 'an unreliable run does not count');
  assert.equal(gate.check(m, [run({ kind: 'manual' })], { now }).ok, false, 'a hand-logged run does not count');
  assert.equal(gate.check(m, [run({ provider: 'openrouter' })], { now }).ok, false,
    'same model on another host needs its own run');
  assert.equal(gate.check(m, [run({ created_at: '2026-09-01T00:00:00Z' })], { now }).ok, false, 'too old');
  assert.equal(gate.check(m, [run({ created_at: '2026-09-01T00:00:00Z' })], { now, maxAgeDays: 90 }).ok, true);
});
test('gate: requireBenchmark refuses with 409 needs_benchmark, honours BENCH_GATE=off and a Super Admin skip',
  async () => {
  const db = (rows) => ({ query: async () => rows });
  const m = { provider: 'nvidia', model: 'new-model' };
  await assert.rejects(gate.requireBenchmark(db([]), m), (e) => e.status === 409 && e.code === 'needs_benchmark');
  const fresh = [{ provider: 'nvidia', model: 'new-model', kind: 'bench', status: 'done', created_at: new Date() }];
  assert.equal((await gate.requireBenchmark(db(fresh), m)).ok, true);
  assert.equal((await gate.requireBenchmark(db([]), m, { isSuper: true,
    skipReason: 'emergency: provider down' })).skipped, 'super_admin');
  await assert.rejects(gate.requireBenchmark(db([]), m, { isSuper: false, skipReason: 'please' }),
    (e) => e.code === 'needs_benchmark');
  await assert.rejects(gate.requireBenchmark({ query: async () => { throw new Error('Unknown column'); } }, m),
    (e) => e.code === 'needs_benchmark');
  process.env.BENCH_GATE = 'off';
  try { assert.equal((await gate.requireBenchmark(db([]), m)).skipped, 'gate_off');
    } finally { delete process.env.BENCH_GATE; }
});
test('results folder path stays inside services/api/bench', () => {
  assert.equal(path.basename(path.dirname(runner.SETS_DIR)), 'bench');
});
