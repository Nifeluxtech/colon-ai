// Unit tests for specialist routing (v0.5.10): the rule-based task classifier, the pure derivation of specialists
// from benchmark category scores (margin, latency, incomplete exclusion, no-eval fallback), head reordering in the
// chain, hedging waves that never pull a demoted model forward, and the on/off setting. No network, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { classify } = require('../../src/modules/ai/classify');
const sp = require('../../src/modules/ai/specialists');
const dynamic = require('../../src/modules/ai/dynamic');
const { chainFor } = require('../../src/modules/ai/generate');
const { orderForHedge } = require('../../src/modules/ai/hedge');

/* ---------- a small routing config and benchmark rows ---------- */
const base = {
  providers: () => ({ g: { name: 'G', baseUrl: 'https://g.example/v1', apiKey: 'k' },
    n: { name: 'N', baseUrl: 'https://n.example/v1', apiKey: 'k' } }),
  targets: () => ({ fast: [{ provider: 'g', model: 'fast-1' }], big: [{ provider: 'g', model: 'big-1' }],
    mm: [{ provider: 'n', model: 'mm-1' }], dead: [{ provider: 'n', model: 'dead-1' }] }),
  routes: { general: ['fast', 'mm', 'big', 'dead'], study: ['fast', 'mm', 'big', 'dead'],
    research: ['fast', 'mm', 'big', 'dead'], developer: ['fast', 'mm', 'big', 'dead'],
    african: ['fast', 'big', 'mm', 'dead'] },
  africanLanguages: ['pcm', 'yo', 'ha', 'ig'], models: [],
};
const SETS = ['coding', 'everyday', 'hausa', 'igbo', 'jamb', 'pidgin', 'reasoning', 'tooluse', 'university', 'waec',
  'yoruba'];
function row(model, provider, acc, ms, status = 'done') {
  return { name: 'Colon benchmark test', provider, model, kind: 'bench', status, first_token_ms: ms,
    details: JSON.stringify({ sets: Object.fromEntries(SETS.map(s => [s, { n: 10, accuracy: (acc[s] ?? 100) / 100,
      first_token_ms: { median: typeof ms === 'object' ? ms[s] ?? ms.all : ms, p90: null } }])) }) };
}
const RUNS = [
  row('fast-1', 'g', { hausa: 90, everyday: 80, coding: 100 }, 800),
  row('big-1', 'g', { hausa: 100, igbo: 100, everyday: 100, coding: 92 }, 3000),
  row('mm-1', 'n', { hausa: 50, yoruba: 60, igbo: 55, everyday: 84, coding: 100 }, 1500),
  row('dead-1', 'n', { hausa: 100, everyday: 100, coding: 100 }, 500, 'failed'),
];
const derive = (runs, o = {}) => sp.derive(runs, { routes: base.routes, targets: base.targets(), ...o });

/* ---------- classifier ---------- */
test('classifier: language from the setting or the message, task from mode, text and attachments', () => {
  const c = (text, o = {}) => classify({ mode: 'general', language: 'en', text, ...o });
  assert.equal(c('Ina kwana? Don allah menene babban birnin Najeriya?').category, 'hausa');
  assert.equal(c('Wetin dey happen? Abeg tell me how far').category, 'pidgin');
  assert.equal(c('Kedu, biko gịnị bụ aha gị?').category, 'igbo');
  assert.equal(c('Hello there', { language: 'yo' }).category, 'yoruba', 'an African setting always wins');
  assert.equal(c('write a python function that reverses a list').category, 'code');
  assert.equal(c('what does this do?', { attachments: ['app.ts'] }).category, 'code');
  assert.equal(c('what does this say?', { attachments: [{ name: 'notes.pdf' }] }).category, 'everyday');
  assert.equal(c('hi', { mode: 'developer' }).category, 'code');
  assert.equal(c('Solve 2x + 3 = 11').category, 'reasoning');
  assert.equal(c('WAEC 2024 past questions on photosynthesis').category, 'exam');
  assert.equal(c('hi', { mode: 'study' }).category, 'exam');
  assert.equal(c('What is the latest news on the naira?').category, 'research');
  assert.equal(c('hi', { web: true }).category, 'research');
  assert.equal(c('How do I cook jollof rice for six people?').category, 'everyday');
  assert.equal(c('```js\nconst a = 1;\n```').language, 'en', 'fenced code is not read as a language');
  const fromMessages = classify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Ina kwana, yaya '
    + 'lafiya?' }, { type: 'image_url', image_url: { url: 'data:' } }] }] });
  assert.equal(fromMessages.category, 'hausa', 'reads the last user message when no text is given');
});

/* ---------- derivation ---------- */
test('derive: a specialist needs the margin plus the latency penalty, and a complete benchmark', () => {
  const d = derive(RUNS);
  assert.equal(d.source, 'bench');
  assert.equal(d.bench, 'Colon benchmark test');
  // Hausa: big 100 vs fast 90 = +10; 2.2 s slower -> needs 90 + 5 + 1.1 = 96.1 -> specialist.
  assert.equal(d.categories.hausa.specialist, 'big');
  assert.equal(d.categories.hausa.required, 96.1);
  // Everyday: big 100 (needs 80 + 5 + 1.1) beats mm 84 (would need 85.4) -> highest score wins.
  assert.equal(d.categories.everyday.specialist, 'big');
  // Code: tie at 100 -> default.
  assert.equal(d.categories.code.specialist, null);
  // Igbo: fast 100 (default) -> big ties -> default.
  assert.equal(d.categories.igbo.specialist, null);
  assert.ok(Object.values(d.categories).every(c => c.specialist !== 'dead'), 'incomplete models are never picked');
  assert.equal(d.categories.hausa.scores.dead.complete, false);
});

test('derive: margin and latency budget are respected; weak and MiniMax-like slots are demoted, never dropped', () => {
  const tight = derive(RUNS, { margin: 11 });
  assert.equal(tight.categories.hausa.specialist, null, 'below the margin keeps the default');
  const slow = derive(RUNS, { maxFirstTokenMs: 2000 });
  assert.equal(slow.categories.hausa.specialist, null, 'over the first-token budget keeps the default');
  assert.match(slow.categories.hausa.reason, /too slow/);
  const d = derive(RUNS);
  assert.deepEqual(d.categories.hausa.demoted, ['mm'], 'complete and under the weak floor');
  assert.deepEqual(d.categories.yoruba.demoted, ['mm']);
  assert.deepEqual(d.categories.code.demoted, []);
  // NEVER_HEAD: a slot named "minimax" stays out of the head for Yorùbá/Hausa/Igbo even with a perfect score.
  const t = { ...base.targets(), minimax: [{ provider: 'n', model: 'mm-1' }] };
  const routes = { ...base.routes, african: ['fast', 'minimax', 'big'] };
  const good = [row('fast-1', 'g', { hausa: 60 }, 800), row('mm-1', 'n', { hausa: 100 }, 800)];
  const m = sp.derive(good, { routes, targets: t });
  assert.equal(m.categories.hausa.specialist, null);
  assert.deepEqual(m.categories.hausa.demoted, ['minimax']);
  assert.equal(m.categories.pidgin.specialist, null);
});

test('derive: no per-set data -> null (static table); default without a benchmark -> no specialist', () => {
  assert.equal(derive([]), null);
  assert.equal(derive([{ provider: 'g', model: 'fast-1', status: 'done', details: null }]), null);
  const d = derive([row('big-1', 'g', { hausa: 100 }, 900)]);
  assert.equal(d.categories.hausa.specialist, null);
  assert.match(d.categories.hausa.reason, /no complete benchmark/);
  assert.equal(sp.tableFor({}), sp.STATIC);
  assert.equal(sp.tableFor({ specialists: d }), d);
});

test('derive on the committed benchmark (2026-11-12) matches the built-in static table', () => {
  const saved = { ...process.env };
  process.env.NVIDIA_API_KEY = 'x'; process.env.GEMINI_API_KEY = 'x';
  try {
    delete require.cache[require.resolve('../../src/modules/ai/routing')];
    const routing = require('../../src/modules/ai/routing');
    const runs = require(path.join(__dirname, '../../bench/results/2026-11-12.eval.json')).runs;
    const d = sp.derive(runs, { routes: routing.routes, targets: routing.targets() });
    for (const c of sp.CATEGORIES) {
      assert.equal(d.categories[c].specialist, sp.STATIC.categories[c].specialist, c);
      assert.deepEqual(d.categories[c].demoted, sp.STATIC.categories[c].demoted, c);
    }
    assert.equal(d.categories.everyday.specialist, 'minimax');
    assert.equal(d.categories.hausa.specialist, null, 'Gemma 4 31B is better in Hausa but ~18 s to first token');
    for (const c of ['yoruba', 'hausa', 'igbo']) assert.deepEqual(d.categories[c].demoted, ['minimax']);
  } finally { process.env = saved; }
});

/* ---------- applying it ---------- */
test('apply and chainFor: the specialist leads, demoted slots go last, nothing is dropped', () => {
  assert.deepEqual(sp.apply(['a', 'b', 'c', 'd'], { specialist: 'c', demoted: ['b'] }), ['c', 'a', 'd', 'b']);
  assert.deepEqual(sp.apply(['a', 'b'], { specialist: 'z', demoted: ['z'] }), ['a', 'b'], 'unknown slots ignored');
  assert.deepEqual(sp.apply(['a', 'b'], null), ['a', 'b']);
  const cfg = { ...base, specialists: derive(RUNS) };
  const hausa = chainFor({ mode: 'general', language: 'ha', category: 'hausa' }, cfg);
  assert.deepEqual(hausa.map(c => c.target), ['big', 'fast', 'dead', 'mm']);
  assert.equal(hausa.route, 'specialist:hausa');
  assert.equal(hausa.find(c => c.target === 'mm').demoted, true);
  const code = chainFor({ mode: 'developer', category: 'code' }, cfg);
  assert.deepEqual(code.map(c => c.target), ['fast', 'mm', 'big', 'dead']);
  assert.equal(code.route, 'default:code');
  const plain = chainFor({ mode: 'general' }, cfg);
  assert.equal(plain.route, 'default');
  assert.deepEqual(plain.map(c => c.target), base.routes.general, 'no category = the plain route');
  const off = chainFor({ mode: 'general', language: 'ha', category: 'hausa' }, { ...cfg, specialistRouting: false });
  assert.deepEqual(off.map(c => c.target), base.routes.african);
  assert.equal(off.route, 'default');
});

test('hedging: waves never pull a demoted model forward', () => {
  const cfg = { ...base, specialists: derive(RUNS) };
  const chain = chainFor({ mode: 'general', language: 'yo', category: 'yoruba' }, cfg);
  assert.deepEqual(chain.map(c => c.target), ['fast', 'big', 'dead', 'mm']);
  assert.deepEqual(orderForHedge(chain, 2).slice(0, 2).map(c => c.target), ['fast', 'dead'],
    'provider mixing picks the next non-demoted model');
  const noDead = chain.filter(c => c.target !== 'dead');
  assert.deepEqual(orderForHedge(noDead, 2).map(c => c.target), ['fast', 'big', 'mm'], 'MiniMax-like stays last');
  assert.deepEqual(orderForHedge(chainFor({ mode: 'general' }, cfg), 2).slice(0, 2).map(c => c.target),
    ['fast', 'mm'], 'unchanged without demotion');
});

/* ---------- settings ---------- */
test('settings: admin on/off beats AI_SPECIALIST_ROUTING; compose derives from the newest import', () => {
  assert.equal(sp.enabledFor({}, undefined), true, 'default on');
  assert.equal(sp.enabledFor({}, 'off'), false);
  assert.equal(sp.enabledFor({ specialistRouting: true }, 'off'), true);
  assert.equal(sp.enabledFor({ specialistRouting: false }, 'on'), false);
  const older = RUNS.map(r => ({ ...r, name: 'Colon benchmark old', details: row(r.model, r.provider, {}, 800)
    .details }));
  const cfg = dynamic.compose({ routing: { specialists: false }, benchRows: [...RUNS, ...older] }, base);
  assert.equal(cfg.specialistRouting, false);
  assert.equal(cfg.specialists.bench, 'Colon benchmark test', 'only the newest import counts');
  assert.equal(cfg.specialists.categories.hausa.specialist, 'big');
  const none = dynamic.compose({}, base);
  assert.equal(none.specialists, undefined);
  assert.equal(none.specialistRouting, undefined);
  assert.deepEqual(dynamic.latestBench([{ kind: 'stub' }]), []);
});

test('bench import accepts the report\'s local "finished" time as well as ISO', () => {
  process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
  const { parseWhen } = require('../../src/modules/admin/handlers/evaluation');
  assert.equal(parseWhen('Thu 2026-11-12 1:52 PM WAT (UTC+01:00)').toISOString(), '2026-11-12T12:52:00.000Z');
  assert.equal(parseWhen('2026-11-12T12:52:00.000Z').toISOString(), '2026-11-12T12:52:00.000Z');
  assert.ok(Number.isNaN(parseWhen('soon').getTime()));
});
