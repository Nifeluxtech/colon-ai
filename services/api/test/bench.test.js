// Unit tests for the Colon benchmark (Phase 5): graders, the code sandbox, aggregation and the score formula,
// the runner against a mock provider (no network), the sets themselves, the report and the model-change gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';

const { grade, extractChoice, extractNumber, extractJson, langScore, fold } = require('../src/bench/graders');
const { runCode } = require('../src/bench/sandbox');
const { aggregate, rank, quantile, speedScore } = require('../src/bench/aggregate');
const runner = require('../src/bench/runner');
const report = require('../src/bench/report');
const gate = require('../src/bench/gate');

/* ---------- graders ---------- */
test('mc: finds the chosen letter in the usual answer shapes', () => {
  for (const [text, want] of [['B', 'B'], ['**C**', 'C'], ['C. Mitochondrion', 'C'], ['The answer is (B).', 'B'], ['Answer: A', 'A'], ['(D) 1999 Constitution', 'D']]) {
    assert.equal(extractChoice(text), want, text);
  }
  assert.equal(grade('B. plentiful', { type: 'mc', answer: 'B' }).pass, true);
  assert.equal(extractChoice('B\n\nWhy: Option A is too small and option D is sound.'), 'B', 'a leading letter beats later "Option A"');
  assert.equal(extractChoice('A fair die has six faces, so the answer is B.'), 'B', 'the article "A" is not a choice');
  assert.equal(grade('A', { type: 'mc', answer: 'B' }).pass, false);
});

test('number: prefers the "Answer:" line, handles ₦, commas, fractions and tolerance', () => {
  assert.equal(extractNumber('3 × 1,200 = 3,600\n5,000 − 3,600 = 1,400\nAnswer: ₦1,400'), 1400);
  assert.equal(extractNumber('Step 1: 2x = 12\nAnswer: x = 6'), 6);
  assert.equal(extractNumber('Answer: 1/2'), 0.5);
  assert.equal(extractNumber('so the total is 26,250'), 26250);
  assert.equal(extractNumber('2^7 ÷ 2^5 = 2^2 = 4\n\n**Check-yourself question:** simplify 3^5 ÷ (3^2 × 3^1)'), 4, 'a closing practice question is ignored');
  assert.equal(grade('Answer: 2.4 Ω', { type: 'number', answer: 2.4, tol: 0.01 }).pass, true);
  assert.equal(grade('Answer: -2', { type: 'number', answer: 2, abs: true }).pass, true);
  assert.equal(grade('Answer: 41', { type: 'number', answer: 42 }).pass, false);
  assert.equal(grade('no digits here', { type: 'number', answer: 1 }).pass, false);
});

test('keywords and regex: accent- and case-insensitive whole-phrase matching', () => {
  assert.equal(fold('Ẹ káàrọ̀ ọ̀rẹ́ mi, ɗaya'), 'e kaaro ore mi, daya');
  assert.equal(grade('Ọ̀la a ó lọ sí ọjà', { type: 'keywords', all: ['ola', 'oja'] }).pass, true);
  assert.equal(grade('Mahaifiyata tana dafa abinci', { type: 'keywords', all: ['abinci'] }).pass, true);
  const partial = grade('The capital is Lagos', { type: 'keywords', all: ['Abuja', 'capital'] });
  assert.equal(partial.pass, false);
  assert.equal(partial.score, 0.5);
  assert.equal(grade('omission', { type: 'keywords', all: ['omi'] }).pass, false, 'whole words only');
  assert.equal(grade('Ẹ ṣé, ọ̀rẹ́ mi', { type: 'regex', pattern: '\\b(e|o)\\s?se\\b' }).pass, true);
});

test('json: bare or fenced JSON, schema subset and loose value match', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(extractJson('Here you go: [1,2]').value, [1, 2]);
  const spec = { type: 'json', schema: { type: 'object', required: ['tool', 'arguments'] }, match: { tool: 'send_money', arguments: { recipient: 'Musa', amount_naira: 5000 } } };
  assert.equal(grade('{"tool":"send_money","arguments":{"recipient":"musa","amount_naira":5000}}', spec).pass, true);
  assert.equal(grade('{"tool":"send_money","arguments":{"recipient":"Musa","amount_naira":500}}', spec).pass, false);
  assert.equal(grade('not json', spec).score, 0);
  const states = { type: 'json', schema: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { type: 'string', enum: ['Lagos', 'Ogun', 'Akwa Ibom'] } } };
  assert.equal(grade('["Lagos","akwa ibom"]', states).pass, true);
  assert.equal(grade('["Lagos","Lagos"]', states).pass, false);
  assert.equal(grade('["Lagos","Texas"]', states).pass, false);
  assert.equal(grade('{"states":["Lagos"],"extra":1}', { type: 'json', schema: { type: 'object', properties: { states: { type: 'array' } }, additionalProperties: false } }).pass, false);
});

test('code: runs in a sandboxed child process with tests and a timeout', () => {
  const tests = [{ args: [2, 3], expect: 5 }, { args: [2, 0], expect: 2 }];
  assert.deepEqual(runCode('function add(a, b) { return a + b; }', 'add', tests).passed, 2);
  assert.equal(runCode('const add = (a, b) => a + b;', 'add', tests).passed, 2);
  assert.equal(runCode('export function add(a, b) { return a + b; }', 'add', tests).passed, 2);
  assert.equal(runCode('function add(a, b) { return a - b; }', 'add', tests).passed, 1);
  const loop = runCode('function add() { while (true) {} }', 'add', tests, 300);
  assert.equal(loop.passed, 0);
  const escape = runCode('function add() { return typeof require + typeof process; }', 'add', [{ args: [], expect: 'undefinedundefined' }]);
  assert.equal(escape.passed, 1, 'no require or process inside the sandbox');
  assert.match(runCode('function other() {}', 'add', tests).error, /not found/);
  const g = grade('Here:\n```javascript\nfunction add(a,b){return a+b}\n```\nDone.', { type: 'code', fn: 'add', tests });
  assert.equal(g.pass, true);
});

test('lang: tells the target language from English, and rewards proper orthography', () => {
  const yo = langScore('Omi mímọ́ ṣe pàtàkì nítorí pé ó ń dáàbò bo ara wa lọ́wọ́ àìsàn. Gbogbo ènìyàn ní láti mu omi tó mọ́.', 'yo');
  assert.equal(yo.pass, true);
  assert.ok(yo.ortho > 0.5);
  const yoBare = langScore('Omi mimo se pataki nitori pe o n dabo bo ara wa. Gbogbo eniyan ni lati mu omi to mo.', 'yo');
  assert.equal(yoBare.pass, true);
  assert.ok(yoBare.ortho < yo.ortho, 'no tone marks scores lower orthography');
  assert.equal(langScore('Clean water is important because it keeps the body healthy and free from disease.', 'yo').pass, false);
  assert.equal(langScore('Yara su je makaranta domin ilimi yana da muhimmanci sosai. Za su sami aiki mai kyau.', 'ha').pass, true);
  assert.equal(langScore('Mmiri dị ọcha dị mkpa maka ahụike anyị. Ọ na-egbochi ọrịa.', 'ig').pass, true);
  assert.equal(langScore('Water is a liquid.', 'ig').pass, false, 'an English line is not Igbo');
  assert.equal(langScore("Mkpịsị aka iri nọ n'aka abụọ.", 'ig').pass, true, 'words in Igbo letters count');
  assert.equal(langScore('Abeg, di capital of Nigeria na Abuja. Na dia government dey sit.', 'pcm').pass, true);
  assert.equal(langScore('The capital of Nigeria is Abuja, which is where the government sits.', 'pcm').pass, false);
  assert.equal(langScore('Na River Benue join River Niger for Lokoja.', 'pcm').pass, true, 'short Naijá answer');
  assert.equal(langScore('Nigeria get 36 states plus one FCT (Abuja). So if you no count the FCT, e still remain 36 states.', 'pcm').pass, true);
  assert.equal(langScore('If you buy two plates of rice for 1,500 naira each, you will pay 3,000 naira.', 'pcm').pass, false, 'plain English stays English');
  const both = grade('Olú ìlú Nàìjíríà ni Abuja. Ìlú náà wà ní àárín gbùngbùn orílẹ̀-èdè wa.', { type: 'all', of: [{ type: 'lang', lang: 'yo' }, { type: 'keywords', all: ['Abuja'] }] });
  assert.equal(both.pass, true);
  assert.ok(both.lang > 0.5);
});

test('every benchmark set loads: unique ids, valid graders, about 120–150 items, all eleven sets', () => {
  const sets = runner.loadSets();
  const names = sets.map(s => s.set).sort();
  assert.deepEqual(names, ['coding', 'everyday', 'hausa', 'igbo', 'jamb', 'pidgin', 'reasoning', 'tooluse', 'university', 'waec', 'yoruba']);
  const items = sets.flatMap(s => s.items);
  assert.ok(items.length >= 120 && items.length <= 150, `${items.length} items`);
  for (const s of sets) assert.ok(s.items.length >= 10 && s.items.length <= 15, `${s.set} has ${s.items.length}`);
  const types = new Set(Object.keys(require('../src/bench/graders').GRADERS));
  const walk = (g) => { assert.ok(types.has(g.type), `grader ${g.type}`); (g.of || []).forEach(walk); };
  for (const it of items) walk(it.grade);
  assert.ok(items.find(i => i.id === 'waec-08').prompt.endsWith(runner.FORMAT.mc));
  assert.equal(items.find(i => i.id === 'yo-01').language, 'yo');
});

test('the coding items are solvable: a reference solution passes every test', () => {
  const ref = {
    isPalindrome: 's => { const t = s.toLowerCase().replace(/[^a-z0-9]/g, ""); return t === [...t].reverse().join(""); }',
    sumEven: 'a => a.filter(x => x % 2 === 0).reduce((x, y) => x + y, 0)',
    fizzBuzz: 'n => Array.from({ length: n }, (_, i) => { const k = i + 1; return k % 15 === 0 ? "FizzBuzz" : k % 3 === 0 ? "Fizz" : k % 5 === 0 ? "Buzz" : String(k); })',
    formatNaira: 'n => "₦" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })',
    isNigerianMobile: 's => /^(0|\\+234)[789][01]\\d{8}$/.test(s)',
    wordCount: 't => { const o = {}; for (const w of t.toLowerCase().match(/[a-z]+/g) || []) o[w] = (o[w] || 0) + 1; return o; }',
    fib: 'n => { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; }',
    chunk: '(a, s) => { const o = []; for (let i = 0; i < a.length; i += s) o.push(a.slice(i, i + s)); return o; }',
    flatten: 'v => v.flat(Infinity)',
    romanToInt: 's => { const m = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let t = 0; for (let i = 0; i < s.length; i++) t += m[s[i]] < (m[s[i + 1]] || 0) ? -m[s[i]] : m[s[i]]; return t; }',
    gcd: '(a, b) => { while (b) [a, b] = [b, a % b]; return a; }',
    average: 'a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0',
  };
  const coding = runner.loadSets(runner.SETS_DIR, ['coding'])[0].items;
  for (const it of coding) {
    const src = `const ${it.grade.fn} = ${ref[it.grade.fn]};`;
    const r = runCode(src, it.grade.fn, it.grade.tests);
    assert.equal(r.passed, r.total, `${it.id}: ${r.error}`);
  }
});

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
    { set: 'yoruba', id: 'd', pass: false, score: 0, lang: null, error: 'timeout: slow', first_token_ms: null, total_ms: 60000 },
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
  assert.deepEqual(rank([m('slow', 80, 9000), m('best', 90, 9000), m('fast', 80, 1000)]).map(x => x.key), ['best', 'fast', 'slow']);
  assert.deepEqual(rank([m('paid', 80, 1000, 2), m('free', 80, 5000, 0)]).map(x => x.key), ['free', 'paid']);
});

/* ---------- runner against a mock provider (no network) ---------- */
function sseFetch(answer, { status = 200, failTimes = 0 } = {}) {
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (n++ < failTimes) return new Response('{"error":{"message":"busy"}}', { status: 503, headers: { 'content-type': 'application/json' } });
    if (status !== 200) return new Response('{"error":{"message":"nope"}}', { status, headers: { 'content-type': 'application/json' } });
    const text = typeof answer === 'function' ? answer(JSON.parse(init.body)) : answer;
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, calls };
}
const mockProvider = { mock: { baseUrl: 'http://mock.local/v1', apiKey: 'k' } };
const routing = require('../src/ai/routing');
const realProviders = routing.providers;

test('runner: grades a reply, sends Saga\'s system prompt for the item\'s mode and language, records timing', async () => {
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
    const bad = await runner.runItem({ provider: 'mock', model: 'm' }, item, { fetch: dead.fetch, retries: 2, backoffMs: [1] });
    assert.equal(bad.pass, false);
    assert.match(bad.error, /upstream_error 503/);
    assert.equal(dead.calls.length, 3);
    let calls429 = 0;
    const limited = async (url, init) => (calls429++ < 3 ? new Response('{"error":{"message":"slow down"}}', { status: 429, headers: { 'content-type': 'application/json' } }) : flaky.fetch(url, init));
    const patient = await runner.runItem({ provider: 'mock', model: 'm' }, item, { fetch: limited, retries: 0, backoffMs: [1], rateBackoffMs: [1] });
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
    const r = await runner.runModel({ provider: 'mock', model: 'm' }, items, { fetch: dead.fetch, retries: 0, backoffMs: [1] });
    assert.equal(r.unreliable, true);
    assert.equal(r.rows.length, 20);
    const good = sseFetch('B');
    const r2 = await runner.runModel({ provider: 'mock', model: 'm' }, items.slice(0, 5), { fetch: good.fetch, done: new Set([items[0].id]) });
    assert.equal(r2.rows.length, 4, 'finished items are skipped on resume');
  } finally { routing.providers = realProviders; }
});

test('sandboxFetch drops only the key headers (bench runner in the sandbox)', async () => {
  let seen;
  const f = runner.sandboxFetch(async (url, init) => { seen = init.headers; return new Response('{}'); });
  await f('https://x', { headers: { Authorization: 'Bearer k', 'x-goog-api-key': 'k', 'Content-Type': 'application/json' } });
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
  const rep = report.buildReport({ run: 't', suite: 'colon-bench-1', started: '2026-11-12T00:00:00Z', finished: '2026-11-12T01:00:00Z', models: [
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
  const run = (over) => ({ provider: 'nvidia', model: 'z-ai/glm-5.3-flash', kind: 'bench', status: 'done', created_at: '2026-11-10T00:00:00Z', ...over });
  const m = { provider: 'nvidia', model: 'z-ai/glm-5.3-flash' };
  assert.equal(gate.check(m, [], { now }).ok, false);
  assert.equal(gate.check(m, [run()], { now }).ok, true);
  assert.equal(gate.check(m, [run({ status: 'failed' })], { now }).ok, false, 'an unreliable run does not count');
  assert.equal(gate.check(m, [run({ kind: 'manual' })], { now }).ok, false, 'a hand-logged run does not count');
  assert.equal(gate.check(m, [run({ provider: 'openrouter' })], { now }).ok, false, 'same model on another host needs its own run');
  assert.equal(gate.check(m, [run({ created_at: '2026-09-01T00:00:00Z' })], { now }).ok, false, 'too old');
  assert.equal(gate.check(m, [run({ created_at: '2026-09-01T00:00:00Z' })], { now, maxAgeDays: 90 }).ok, true);
});

test('gate: requireBenchmark refuses with 409 needs_benchmark, honours BENCH_GATE=off and a Super Admin skip', async () => {
  const db = (rows) => ({ query: async () => rows });
  const m = { provider: 'nvidia', model: 'new-model' };
  await assert.rejects(gate.requireBenchmark(db([]), m), (e) => e.status === 409 && e.code === 'needs_benchmark');
  const fresh = [{ provider: 'nvidia', model: 'new-model', kind: 'bench', status: 'done', created_at: new Date() }];
  assert.equal((await gate.requireBenchmark(db(fresh), m)).ok, true);
  assert.equal((await gate.requireBenchmark(db([]), m, { isSuper: true, skipReason: 'emergency: provider down' })).skipped, 'super_admin');
  await assert.rejects(gate.requireBenchmark(db([]), m, { isSuper: false, skipReason: 'please' }), (e) => e.code === 'needs_benchmark');
  await assert.rejects(gate.requireBenchmark({ query: async () => { throw new Error('Unknown column'); } }, m), (e) => e.code === 'needs_benchmark');
  process.env.BENCH_GATE = 'off';
  try { assert.equal((await gate.requireBenchmark(db([]), m)).skipped, 'gate_off'); } finally { delete process.env.BENCH_GATE; }
});

test('results folder path stays inside services/api/bench', () => {
  assert.equal(path.basename(path.dirname(runner.SETS_DIR)), 'bench');
});

/* ---------- gate wired into the admin save paths ---------- */
test('admin: adding, changing or re-enabling a model, or a new first choice in routing, needs a fresh benchmark', async () => {
  const dbPath = require.resolve('../src/db');
  const state = { runs: [], sql: [], model: { id: 7, provider_id: 'nvidia', model: 'z-ai/glm-5.3-flash', enabled: 1 } };
  const fakeDb = {
    async query(sql, p) {
      state.sql.push(sql);
      if (/COUNT\(\*\)/.test(sql)) return [{ c: 1 }];
      if (/FROM eval_runs/.test(sql)) return state.runs.filter(r => !p || (r.provider === p[0] && r.model === p[1]));
      if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) return { insertId: 99, affectedRows: 1 };
      return [];
    },
    async one(sql) { return /FROM ai_models/.test(sql) ? state.model : null; },
  };
  const saved = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
  for (const k of Object.keys(require.cache)) if (/src[\\/](http|lib[\\/](audit|settings))/.test(k)) delete require.cache[k];
  try {
    const r = require('../src/http/routes/admin-ai');
    const find = (m, p) => r.routes.find(x => x.method === m && x.re.test(p)).handlers[1];
    const req = (body, role = 'admin', params = {}) => ({ user: { id: 1, role, totp_enabled: 1 }, params, body, ip: '', headers: {} });
    const fresh = { provider: 'nvidia', model: 'minimaxai/minimax-m3.1-flash', kind: 'bench', status: 'done', created_at: new Date() };

    const add = find('POST', '/admin/models');
    const body = { target: 'minimax', provider_id: 'nvidia', model: 'minimaxai/minimax-m3.1-flash' };
    await assert.rejects(add(req(body)), (e) => e.status === 409 && e.code === 'needs_benchmark');
    await assert.rejects(add(req({ ...body, skip_benchmark: 'urgent' })), (e) => e.code === 'needs_benchmark', 'only a super admin can skip');
    const [st] = await add(req({ ...body, skip_benchmark: 'provider outage, benchmark running' }, 'super_admin'));
    assert.equal(st, 201);
    assert.ok(state.sql.some(s => /audit/i.test(s)), 'the skip is audited');
    const [, disabled] = await add(req({ ...body, enabled: false }));
    assert.equal(disabled.ok, true, 'adding a disabled model is not gated');
    state.runs = [fresh];
    assert.equal((await add(req(body)))[0], 201);

    const patch = find('PATCH', '/admin/models/7');
    await assert.rejects(patch(req({ model: 'brand-new/model' }, 'admin', { id: '7' })), (e) => e.code === 'needs_benchmark');
    assert.equal((await patch(req({ priority: 3 }, 'admin', { id: '7' })))[0], 200, 'reordering is not a model change');
    state.model = { ...state.model, enabled: 0 };
    await assert.rejects(patch(req({ enabled: true }, 'admin', { id: '7' })), (e) => e.code === 'needs_benchmark', 're-enabling an unbenchmarked model');
    state.runs = [{ ...fresh, model: 'z-ai/glm-5.3-flash' }];
    assert.equal((await patch(req({ enabled: true }, 'admin', { id: '7' })))[0], 200);

    const routingPatch = find('PATCH', '/admin/routing');
    require('../src/ai/dynamic').clear();
    state.runs = [];
    await assert.rejects(routingPatch(req({ routes: { general: ['glm', 'deepseek'] } })), (e) => e.code === 'needs_benchmark', 'new Saga default');
    assert.equal((await routingPatch(req({ routes: { general: ['gemma', 'glm'] } })))[0], 200, 'same first choice, new fallbacks');

    const imp = find('POST', '/admin/evaluation/bench');
    const evalRows = report.evalRows(report.buildReport({ run: 'x', suite: 'colon-bench-1', started: '', finished: new Date().toISOString(),
      models: [{ provider: 'nvidia', model: 'z-ai/glm-5.3-flash', rows: [{ set: 'waec', id: 'w', pass: true, score: 1, first_token_ms: 1, total_ms: 2 }], expected: 1 }] }));
    const [ist, ires] = await imp(req(JSON.parse(JSON.stringify({ runs: evalRows }))));
    assert.equal(ist, 201);
    assert.equal(ires.ids.length, 1);
    await assert.rejects(imp(req({ runs: [{ provider: 'nvidia', model: 'm', score: 140, created_at: new Date().toISOString() }] })), (e) => e.status === 422);
  } finally {
    if (saved) require.cache[dbPath] = saved; else delete require.cache[dbPath];
  }
});
