// Crash Predictor 0.39.3: a guessed multiplier range for the next round, from the user's last rounds.
//   guess(xs) -> { range: { low, high }, big: { low, high }, big_chance, big_share, rounds_used, window, label,
//                  after_last } | null when fewer than MIN_ROUNDS rounds   (xs: all stored multipliers, oldest first)
//   afterLast(xs) -> { bucket, bucket_label, samples, reached_2x, rate, all_rounds, all_reached_2x, all_rate } | null
// after_last is a measured count, not a guess: the newest round's bucket (< 1.20x, 1.20-2x, 2-10x, >= 10x), and over
// all stored rounds how many rounds that followed a round in that bucket reached 2x, next to the 2x rate of all
// rounds. Null with fewer than MIN_AFTER (20) such rounds.
// range is calibrated (calibrate.js): the narrowest interval of the newest WINDOW (30) rounds at a coverage level
// tuned by replaying the last 100 rounds so about 7 of 10 next rounds fell inside (level, coverage_target 0.7,
// coverage_measured, samples). big is the 90th to 97th percentile and big_chance the share of those rounds at or
// above big.low ("about 1 in 10"); percentiles interpolate linearly between sorted values, 2 decimals.
// transitions is the 4 x 4 bucket-to-bucket table over all stored rounds (after_last is its newest row's 2x
// share), and reasoning a plain one-to-two-line account of how the guess was made.
// mean and median of the same 30 rounds, and reach: the share of them at or above 1.5x, 2x, 5x and 10x next to the
// published 0.97 / m baseline.
// It is only a description of past rounds, shown as a guess. It never feeds the verdict (BET / WAIT / STOP) or
// auto-bet: engine.js and autobet-rules.js do not read it. Each JetX round is independent of the ones before it.
const C = require('./calibrate');

const WINDOW = C.WINDOW;
const ALL_ROUNDS = 5000; // the stored rounds read for after_last (the analysis engine's limit)
const MIN_ROUNDS = 10;
const MIN_AFTER = 20;
const REACH = 2;
const LEVELS = Object.freeze([1.5, 2, 5, 10]);
const BUCKETS = Object.freeze([
  { id: 'lt_1.2', label: 'under 1.20x', name: 'under 1.20x', short: '<1.20', test: (x) => x < 1.2 },
  { id: '1.2_2', label: 'at 1.20–2x', name: '1.20–2x', short: '1.20–2', test: (x) => x < 2 },
  { id: '2_10', label: 'at 2–10x', name: '2–10x', short: '2–10', test: (x) => x < 10 },
  { id: 'ge_10', label: 'at 10x or more', name: '10x or more', short: '≥10', test: () => true },
]);
const bucketOf = (x) => BUCKETS.find((b) => b.test(x));
const rate4 = (k, n) => (n ? Math.round((k / n) * 1e4) / 1e4 : null);

const r2 = (x) => Math.round(x * 100) / 100;

// The p-th percentile (0..1) of an ascending list, linear between neighbours.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

// "about 1 in 10" from a share (0..1); "none of them" for 0.
function oneIn(share) {
  if (!(share > 0)) return 'none of them';
  return `about 1 in ${Math.max(1, Math.round(1 / share))}`;
}

const clean = (xs) => (xs || []).map(Number).filter((x) => Number.isFinite(x) && x >= 1);

function afterLast(xs) {
  const list = clean(xs);
  if (list.length < 2) return null;
  const b = bucketOf(list[list.length - 1]);
  let samples = 0;
  let reached = 0;
  for (let i = 1; i < list.length; i += 1) {
    if (bucketOf(list[i - 1]).id !== b.id) continue;
    samples += 1;
    if (list[i] >= REACH) reached += 1;
  }
  if (samples < MIN_AFTER) return null;
  const all = list.filter((x) => x >= REACH).length;
  return { bucket: b.id, bucket_label: b.label, samples, reached_2x: reached, rate: rate4(reached, samples),
    all_rounds: list.length, all_reached_2x: all, all_rate: rate4(all, list.length) };
}

// transitions: over all stored rounds, how often a round in bucket i (rows) was followed by one in bucket j
// (columns): counts, row percentages (null for an empty row), row totals and the newest round's row (current).
function transitions(xs) {
  const list = clean(xs);
  const idx = (x) => BUCKETS.indexOf(bucketOf(x));
  const counts = BUCKETS.map(() => BUCKETS.map(() => 0));
  for (let i = 1; i < list.length; i += 1) counts[idx(list[i - 1])][idx(list[i])] += 1;
  const totals = counts.map((row) => row.reduce((a, b) => a + b, 0));
  return { buckets: BUCKETS.map((b) => ({ id: b.id, label: b.short })), counts,
    row_pct: counts.map((row, i) => row.map((c) => rate4(c, totals[i]))), row_totals: totals,
    current: list.length ? idx(list[list.length - 1]) : null, pairs: Math.max(0, list.length - 1) };
}

const pc = (r) => `${Math.round(r * 100)}%`;
const x2s = (x) => `${Number(x).toFixed(2)}x`;

// One or two plain lines on how the guess was made (display only).
function reasoning(list, g) {
  const last = list[list.length - 1];
  const a = g.after_last;
  const after = a ? `After rounds like that, ${pc(a.rate)} of next rounds reached 2x (${a.samples} samples); `
    + `all rounds ${pc(a.all_rate)}.` : 'Too few rounds like that yet to say what followed them.';
  const held = g.coverage_measured == null ? '' : ` (held ${pc(g.coverage_measured)} of the last ${g.samples} on `
    + 'replay)';
  return `Last round ${x2s(last)} (${bucketOf(last).name}). ${after} Range ${x2s(g.range.low).slice(0, -1)}–`
    + `${x2s(g.range.high)} covers ~${pc(g.level)} of the last ${g.rounds_used} rounds${held}; median `
    + `${x2s(g.median)}.`;
}

function guess(xs) {
  const list = clean(xs);
  const used = list.slice(-WINDOW);
  if (used.length < MIN_ROUNDS) return null;
  const sorted = [...used].sort((a, b) => a - b);
  const q = (p) => r2(percentile(sorted, p));
  const big = { low: q(0.9), high: q(0.97) };
  const share = used.filter((x) => x >= big.low).length / used.length;
  const cal = C.calibrated(list.slice(-(C.REPLAY + WINDOW)));
  const g = {
    range: cal.range,
    level: cal.level,
    coverage_target: cal.coverage_target,
    coverage_measured: cal.coverage_measured,
    samples: cal.samples,
    big,
    big_chance: oneIn(share),
    big_share: rate4(share * used.length, used.length),
    mean: r2(used.reduce((a, b) => a + b, 0) / used.length),
    median: q(0.5),
    reach: LEVELS.map((m) => ({ at: m, share: rate4(used.filter((x) => x >= m).length, used.length),
      baseline: Math.round((0.97 / m) * 1e4) / 1e4 })),
    rounds_used: used.length,
    window: WINDOW,
    label: `Guess from last ${used.length} rounds, not a prediction`,
    after_last: afterLast(list),
    transitions: transitions(list),
  };
  g.reasoning = reasoning(list, g);
  return g;
}

module.exports = { guess, transitions, reasoning, ALL_ROUNDS, afterLast, bucketOf, percentile, oneIn, WINDOW,
  MIN_ROUNDS, MIN_AFTER, BUCKETS, LEVELS };
