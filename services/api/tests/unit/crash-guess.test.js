// Unit tests for Colon's guessed range (0.39.3): the percentile math over the last 30 rounds, null below 10 rounds,
// the measured "after a round like the last one" line, and that neither changes the verdict or auto-bet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crash = require('../../src/modules/crash');
const G = crash.guess;
const E = crash.engine;

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
  return { store, e: crash.create({ store, clock: () => new Date(T0) }) };
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

test('guess: 25th-75th and 90th-97th percentiles of the last 30 rounds, labelled a guess', () => {
  const g = G.guess(seq(10, (i) => i + 1).reverse()); // order does not matter for the range
  assert.deepEqual(g.range, { low: 3.25, high: 7.75 });
  assert.deepEqual(g.big, { low: 9.1, high: 9.73 });
  assert.equal(g.big_chance, 'about 1 in 10');
  assert.equal(g.big_share, 0.1);
  assert.equal(g.rounds_used, 10);
  assert.equal(g.label, 'Guess from last 10 rounds, not a prediction');
  // 40 rounds: the 10 oldest (1000x) fall outside the window of 30.
  const xs = [...seq(10, () => 1000), ...seq(30, (i) => 1 + i / 10)];
  const w = G.guess(xs);
  assert.equal(w.rounds_used, 30);
  assert.equal(w.window, 30);
  assert.ok(w.big.high < 5);
  assert.deepEqual(w.range, { low: 1.73, high: 3.18 });
  assert.equal(w.big_chance, 'about 1 in 10');
  assert.match(w.label, /^Guess from last 30 rounds, not a prediction$/);
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
