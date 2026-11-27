// Crash Predictor 0.39.3: a guessed multiplier range for the next round, from the user's last rounds.
//   guess(xs) -> { range: { low, high }, big: { low, high }, big_chance, big_share, rounds_used, window, label,
//                  after_last } | null when fewer than MIN_ROUNDS rounds   (xs: all stored multipliers, oldest first)
//   afterLast(xs) -> { bucket, bucket_label, samples, reached_2x, rate, all_rounds, all_reached_2x, all_rate } | null
// after_last is a measured count, not a guess: the newest round's bucket (< 1.20x, 1.20-2x, 2-10x, >= 10x), and over
// all stored rounds how many rounds that followed a round in that bucket reached 2x, next to the 2x rate of all
// rounds. Null with fewer than MIN_AFTER (20) such rounds.
// range is the 25th to 75th percentile of the newest WINDOW (30) rounds, big the 90th to 97th, and big_chance the
// share of those rounds at or above big.low ("about 1 in 10"). Percentiles interpolate linearly between the sorted
// values (the usual "type 7" rule), rounded to 2 decimals.
// It is only a description of past rounds, shown as a guess. It never feeds the verdict (BET / WAIT / STOP) or
// auto-bet: engine.js and autobet-rules.js do not read it. Each JetX round is independent of the ones before it.
const WINDOW = 30;
const ALL_ROUNDS = 5000; // the stored rounds read for after_last (the analysis engine's limit)
const MIN_ROUNDS = 10;
const MIN_AFTER = 20;
const REACH = 2;
const BUCKETS = Object.freeze([
  { id: 'lt_1.2', label: 'under 1.20x', test: (x) => x < 1.2 },
  { id: '1.2_2', label: 'at 1.20–2x', test: (x) => x < 2 },
  { id: '2_10', label: 'at 2–10x', test: (x) => x < 10 },
  { id: 'ge_10', label: 'at 10x or more', test: () => true },
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

function guess(xs) {
  const list = clean(xs);
  const used = list.slice(-WINDOW);
  if (used.length < MIN_ROUNDS) return null;
  const sorted = [...used].sort((a, b) => a - b);
  const q = (p) => r2(percentile(sorted, p));
  const big = { low: q(0.9), high: q(0.97) };
  const share = used.filter((x) => x >= big.low).length / used.length;
  return {
    range: { low: q(0.25), high: q(0.75) },
    big,
    big_chance: oneIn(share),
    big_share: Math.round(share * 1e4) / 1e4,
    rounds_used: used.length,
    window: WINDOW,
    label: `Guess from last ${used.length} rounds, not a prediction`,
    after_last: afterLast(list),
  };
}

module.exports = { guess, ALL_ROUNDS, afterLast, bucketOf, percentile, oneIn, WINDOW, MIN_ROUNDS, MIN_AFTER, BUCKETS };
