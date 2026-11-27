// Unit tests for Colon's guessed range (0.39.3): the percentile math over the last 30 rounds, null below 10 rounds,
// the measured "after a round like the last one" line, and that neither changes the verdict or auto-bet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crash = require('../../src/modules/crash');
const G = crash.guess;
const E = crash.engine;
const C = require('../../src/modules/crash/calibrate');

const ada = { id: 1, name: 'Ada Obi', email: 'ada@example.com' };
const T0 = Date.UTC(2026, 10, 27, 9, 0, 0);
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// A fixed pseudo-random JetX-like series (0.97 / m tail), oldest first.
function fair(n, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return seq(n, () => Math.max(1, Math.floor((0.97 / (1 - rnd())) * 100) / 100));
}
async function seeded(xs) {
  const store = crash.memoryStore();
  await store.insertRounds(1, 'jetx', xs.map((m, i) => ({ round_id: `r${i}`, multiplier: m,
    observed_at: new Date(T0 - (xs.length - i) * 10000), source: 'collector' })));
  return { store, e: crash.create({ store, clock: () => new Date(T0), aiGenerate: async () => ({ text: 'x' }),
    aiOn: () => false }) };
}

test('percentile: linear between sorted neighbours', () => {
  const s = seq(10, (i) => i + 1);
  assert.equal(G.percentile(s, 0), 1);
  assert.equal(G.percentile(s, 1), 10);
  assert.equal(G.percentile(s, 0.25), 3.25);
  assert.equal(G.percentile(s, 0.5), 5.5);
  assert.ok(Math.abs(G.percentile(s, 0.97) - 9.73) < 1e-9);
  assert.equal(G.percentile([2.5], 0.9), 2.5);
  assert.equal(G.percentile([], 0.5), null);
  assert.equal(G.oneIn(0.1), 'about 1 in 10');
  assert.equal(G.oneIn(0.0667), 'about 1 in 15');
  assert.equal(G.oneIn(0), 'none of them');
});

test('guess: calibrated range, big range (90th-97th), mean, median and reach shares of the last 30 rounds', () => {
  const g = G.guess(seq(10, (i) => i + 1).reverse()); // order does not matter for the ranges
  assert.deepEqual(g.range, { low: 1, high: 7 }); // the narrowest 70% interval (7 of 10); no replay yet
  assert.deepEqual([g.level, g.coverage_target, g.coverage_measured, g.samples], [0.7, 0.7, null, 0]);
  assert.deepEqual(g.big, { low: 9.1, high: 9.73 });
  assert.equal(g.big_chance, 'about 1 in 10');
  assert.equal(g.big_share, 0.1);
  assert.deepEqual([g.mean, g.median], [5.5, 5.5]);
  assert.deepEqual(g.reach, [{ at: 1.5, share: 0.9, baseline: 0.6467 }, { at: 2, share: 0.9, baseline: 0.485 },
    { at: 5, share: 0.6, baseline: 0.194 }, { at: 10, share: 0.1, baseline: 0.097 }]);
  assert.equal(g.rounds_used, 10);
  assert.equal(g.label, 'Guess from last 10 rounds, not a prediction');
  // 40 rounds: the 10 oldest (1000x) fall outside the window of 30.
  const xs = [...seq(10, () => 1000), ...seq(30, (i) => 1 + i / 10)];
  const w = G.guess(xs);
  assert.equal(w.rounds_used, 30);
  assert.equal(w.window, 30);
  assert.ok(w.big.high < 5);
  assert.equal(w.median, 2.45);
  assert.equal(w.mean, 2.45);
  assert.equal(w.big_chance, 'about 1 in 10');
  assert.match(w.label, /^Guess from last 30 rounds, not a prediction$/);
});

test('calibration: narrowest interval, replayed coverage, level stepped toward 70% within 50-95%', () => {
  assert.deepEqual(C.narrowest([1, 1.1, 1.2, 1.3, 5, 50, 100, 1.05, 1.15, 1.25], 0.7), { low: 1, high: 1.3 });
  assert.deepEqual(C.narrowest([1, 1.1, 1.2, 1.3, 5, 50, 100, 1.05, 1.15, 1.25], 0.5), { low: 1, high: 1.2 });
  assert.equal(C.narrowest([], 0.7), null);
  assert.deepEqual(C.replay(seq(50, () => 2), 0.7), { hits: 40, samples: 40, coverage: 1 });
  for (const sd of [1, 2, 3, 4, 5, 7, 11, 13]) {
    const xs = fair(130, sd);
    const start = C.replay(xs, 0.7);
    const c = C.calibrated(xs);
    assert.equal(c.samples, 100);
    assert.ok(c.level >= 0.5 && c.level <= 0.95);
    assert.equal(Math.round(c.level * 100) % 5, 0);
    assert.ok(Math.abs(c.coverage_measured - 0.7) <= Math.abs(start.coverage - 0.7) + 1e-9, `seed ${sd}`);
    assert.equal(c.coverage_measured, C.replay(xs, c.level).coverage);
    assert.deepEqual(c.range, C.narrowest(xs.slice(-30), c.level));
    if (Math.abs(start.coverage - 0.7) <= C.TOLERANCE) assert.equal(c.level, 0.7);
  }
  // under-covering at 70% (fair seed 4: 61%) steps up; over-covering (a wide past then a tight run) steps down.
  const up = C.calibrated(fair(130, 4));
  assert.ok(up.level > 0.7 && up.coverage_measured > 0.61);
  const tight = [...seq(30, (i) => 1 + i), ...seq(100, (i) => 1.5 + (i % 3) * 0.01)];
  assert.equal(C.replay(tight, 0.7).coverage, 1);
  const down = C.calibrated(tight);
  assert.equal(down.level, 0.5);
  assert.ok(down.coverage_measured < 1);
  // too few replayed rounds: stays at 70%.
  const few = C.calibrated(fair(25, 3));
  assert.equal(few.level, 0.7);
  assert.equal(few.samples, 15);
  assert.equal(G.guess(fair(130, 4)).level, up.level);
});

test('transitions and reasoning: 4 x 4 bucket table with row %, the newest row, and a plain account', () => {
  const xs = [];
  for (let i = 0; i < 25; i += 1) xs.push(1.1, i < 10 ? 3 : 1.5);
  xs.push(1.04);
  const t = G.transitions(xs);
  assert.deepEqual(t.buckets.map((b) => b.label), ['<1.20', '1.20–2', '2–10', '≥10']);
  assert.deepEqual(t.counts, [[0, 15, 10, 0], [15, 0, 0, 0], [10, 0, 0, 0], [0, 0, 0, 0]]);
  assert.deepEqual(t.row_pct[0], [0, 0.6, 0.4, 0]);
  assert.deepEqual(t.row_pct[3], [null, null, null, null]);
  assert.deepEqual([t.row_totals, t.current, t.pairs], [[25, 15, 10, 0], 0, 50]);
  assert.equal(G.transitions([]).current, null);
  const g = G.guess(xs);
  assert.deepEqual(g.transitions, t);
  assert.match(g.reasoning, /^Last round 1\.04x \(under 1\.20x\)\. After rounds like that, 40% of next /);
  assert.match(g.reasoning, /rounds reached 2x /);
  assert.match(g.reasoning, /\(25 samples\); all rounds 20%\. Range .* covers ~\d+% of the last 30 rounds/);
  assert.match(g.reasoning, /median 1\.30x\.$/);
  assert.match(G.guess(seq(12, () => 15)).reasoning, /\(10x or more\)\. Too few rounds like that yet/);
});

test('guess: null below 10 rounds; bad values are dropped first', () => {
  assert.equal(G.guess([]), null);
  assert.equal(G.guess(null), null);
  assert.equal(G.guess(seq(9, () => 2)), null);
  assert.equal(G.guess([...seq(9, () => 2), 0.5, NaN, 'x']), null);
  assert.ok(G.guess(seq(10, () => 2)));
});

test('after_last: bucket of the newest round, rounds after that bucket reaching 2x, null under 20 samples', () => {
  assert.equal(G.bucketOf(1.19).id, 'lt_1.2');
  assert.equal(G.bucketOf(1.2).id, '1.2_2');
  assert.equal(G.bucketOf(1.99).id, '1.2_2');
  assert.equal(G.bucketOf(2).id, '2_10');
  assert.equal(G.bucketOf(10).id, 'ge_10');
  // pairs (1.1, next): 25 lows each followed by 3.0 (10 times) or 1.5 (15 times), then a final low.
  const xs = [];
  for (let i = 0; i < 25; i += 1) xs.push(1.1, i < 10 ? 3 : 1.5);
  xs.push(1.05);
  const a = G.afterLast(xs);
  assert.deepEqual(a, { bucket: 'lt_1.2', bucket_label: 'under 1.20x', samples: 25, reached_2x: 10, rate: 0.4,
    all_rounds: 51, all_reached_2x: 10, all_rate: 0.1961 });
  assert.equal(G.guess(xs).after_last.samples, 25);
  // only 19 rounds follow a low one -> null, while the range is still given.
  const few = xs.slice(xs.length - 39);
  assert.equal(G.afterLast(few), null);
  assert.equal(G.guess(few).after_last, null);
  assert.ok(G.guess(few).range);
  assert.equal(G.afterLast([1.1]), null);
});

test('the guess never changes the verdict or auto-bet; engine and auto-bet rules do not read it', async () => {
  const src = path.join(__dirname, '../../src/modules/crash');
  for (const f of ['engine.js', 'autobet-rules.js', 'strategies.js', 'stats.js', 'settings.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(src, f), 'utf8'), /require\(['"]\.\/guess['"]\)/, f);
  }
  for (const xs of [fair(40), fair(400, 3), seq(40, (i) => (i % 2 ? 1.5 : 1.35))]) {
    const { e } = await seeded(xs);
    const live = await e.live(ada);
    const an = await e.analysis(ada);
    const bare = E.verdict(E.analyse(xs, 1.3), null);
    assert.ok(live.guess && an.guess);
    assert.deepEqual(live.guess, an.guess);
    assert.equal(live.verdict.action, bare.action);
    assert.equal(live.verdict.reason, bare.reason);
    assert.equal(an.verdict.action, bare.action);
    assert.deepEqual(an.verdict.numbers, bare.numbers);
    const d = await e.decide(ada, { control: 'ai', dry_run: true });
    assert.equal(d.verdict.action, bare.action);
    assert.equal(d.guess, undefined);
  }
  const { e } = await seeded(seq(40, (i) => (i % 2 ? 1.5 : 1.35)));
  assert.equal((await e.live(ada)).verdict.action, 'BET'); // every round >= 1.30x: BET as before, guess or not
});

test('live and analysis: guess null before 10 rounds, the verdict still collecting', async () => {
  const { e } = await seeded([1.5, 2.2, 1.01]);
  const live = await e.live(ada);
  assert.equal(live.guess, null);
  assert.equal(live.verdict.reason, 'collecting rounds (3/10)');
  assert.equal((await e.analysis(ada)).guess, null);
});
