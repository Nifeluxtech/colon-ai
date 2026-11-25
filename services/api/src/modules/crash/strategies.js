// Crash Predictor step 4 (v0.36.0): a small set of transparent betting rules, each tested ONLY on rounds it has not
// seen. The rounds (oldest first) are split in time: the earlier half chooses a rule, the later half tests it.
// A rule's condition for round i reads only rounds before i, so nothing leaks from the round being judged.
//   STRATEGIES                 [{ id, name, rule, when(xs, i, ctx) }]
//   evaluate(xs, target, opts) -> { split_at, train_rounds, test_rounds, tests, alpha, z_corrected, rows, selected }
// Every row reports the test half: bets, hits, hit rate, Wilson 95% range, a Bonferroni-corrected lower bound
// (alpha 0.05 shared across all the rules), ROI per unit staked at the target, and whether it beats break-even.
const M = require('./math');
const D = require('./dist');
const { breakEven } = require('./stats');

const r4 = (x) => (x == null || !Number.isFinite(x) ? null : M.round(x, 4));
const lastAll = (xs, i, k, f) => {
  if (i < k) return false;
  for (let j = i - k; j < i; j += 1) if (!f(xs[j])) return false;
  return true;
};
const share20 = (xs, i, t) => {
  let h = 0;
  for (let j = i - 20; j < i; j += 1) if (xs[j] >= t) h += 1;
  return h / 20;
};

const afterBelow = (k) => ({ id: `after_${k}_below`, name: `After ${k} below target`,
  rule: k === 1 ? 'Bet when the last round crashed below the target.'
    : `Bet when the last ${k} rounds all crashed below the target.`,
  when: (xs, i, c) => lastAll(xs, i, k, (x) => x < c.target) });

const STRATEGIES = Object.freeze([
  { id: 'always', name: 'Every round', rule: 'Bet on every round.', when: () => true },
  afterBelow(1), afterBelow(2), afterBelow(3), afterBelow(4),
  { id: 'after_3_above', name: 'After 3 above target', rule: 'Bet when the last 3 rounds all reached the target.',
    when: (xs, i, c) => lastAll(xs, i, 3, (x) => x >= c.target) },
  { id: 'after_big', name: 'After a 5x+ round', rule: 'Bet when the last round reached 5x or more.',
    when: (xs, i) => i >= 1 && xs[i - 1] >= 5 },
  { id: 'after_instant', name: 'After an early crash', rule: 'Bet when the last round crashed below 1.10x.',
    when: (xs, i) => i >= 1 && xs[i - 1] < 1.1 },
  { id: 'cold_20', name: 'Cold last 20', rule: 'Bet when fewer of the last 20 rounds reached the target than the '
    + 'baseline expects.', when: (xs, i, c) => i >= 20 && share20(xs, i, c.target) < c.base },
  { id: 'hot_20', name: 'Hot last 20', rule: 'Bet when more of the last 20 rounds reached the target than the '
    + 'baseline expects.', when: (xs, i, c) => i >= 20 && share20(xs, i, c.target) > c.base },
]);

const ALPHA = 0.05;
const TRAIN_SHARE = 0.5;
const MIN_TRAIN_BETS = 30;

function tally(xs, from, to, s, ctx) {
  let bets = 0; let hits = 0;
  for (let i = from; i < to; i += 1) {
    if (!s.when(xs, i, ctx)) continue;
    bets += 1;
    if (xs[i] >= ctx.target) hits += 1;
  }
  return { bets, hits };
}

function evaluate(xs, target, { trainShare = TRAIN_SHARE, strategies = STRATEGIES } = {}) {
  const t = Number(target); const n = xs.length; const be = breakEven(t);
  const ctx = { target: t, base: M.baseline(t) };
  const split = Math.floor(n * trainShare);
  const tests = strategies.length;
  const z = D.zFor(ALPHA / tests);
  const rows = strategies.map((s) => {
    const train = tally(xs, 0, split, s, ctx);
    const test = tally(xs, split, n, s, ctx);
    const range = M.wilson(test.hits, test.bets);
    const corrected = M.wilson(test.hits, test.bets, z);
    const trainRange = M.wilson(train.hits, train.bets);
    return {
      id: s.id, name: s.name, rule: s.rule,
      train: { bets: train.bets, hits: train.hits, rate: train.bets ? r4(train.hits / train.bets) : null,
        low: trainRange ? trainRange.low : null },
      test: { bets: test.bets, hits: test.hits, rate: test.bets ? r4(test.hits / test.bets) : null,
        low: range ? range.low : null, high: range ? range.high : null,
        corrected_low: corrected ? corrected.low : null,
        roi: test.bets ? r4((test.hits * t - test.bets) / test.bets) : null },
      beats_break_even: corrected ? corrected.low > be : false,
      condition_now: Boolean(s.when(xs, n, ctx)),
    };
  });
  // The earlier half alone picks the rule: the best 95% lower bound among rules with enough earlier bets.
  let selected = null;
  for (const r of rows) {
    if (r.train.bets < MIN_TRAIN_BETS) continue;
    if (!selected || r.train.low > selected.train.low) selected = r;
  }
  return { split_at: split, train_rounds: split, test_rounds: n - split, tests, alpha: ALPHA, z_corrected: r4(z),
    break_even: be, rows, selected: selected ? selected.id : null,
    method: `Rounds are split in time: the earlier ${split} choose a rule, the later ${n - split} test it. `
      + `The lower bound is corrected for testing ${tests} rules at once (Bonferroni).` };
}

module.exports = { STRATEGIES, evaluate, ALPHA, TRAIN_SHARE, MIN_TRAIN_BETS };
