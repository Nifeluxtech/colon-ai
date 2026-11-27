// Crash Predictor step 4 (v0.36.0): the analysis engine. It measures the user's JetX rounds against the published
// odds and tests a few transparent rules on rounds they have not seen. It never predicts a round.
//   analyse(xs, target, { minChance }) -> { stats, strategies, decision }   (xs: multipliers, oldest first)
//   verdict(analysis, rails) -> { action, verdict, reason, strategy, numbers, engine: true, note }
// 0.39.2: an estimate from MIN_ROUNDS (10) rounds, and BET only when it reaches minChance (config
// CRASH_BET_MIN_CHANCE, default 0.80). The estimate of P(next round >= target) is
//   'rule'      the chosen rule's hit rate on unseen rounds, when (from DATA_ROUNDS rounds) the data fit the published
//               odds, it has >= MIN_TEST_BETS unseen bets, its corrected lower bound beats break-even and its
//               condition holds for the next round;
//   'measured'  otherwise the hit rate of the analysed rounds eased toward the baseline 0.97 / target by PRIOR
//               pseudo-rounds: (hits + PRIOR * baseline) / (rounds + PRIOR).
// The verdict, in order:
//   STOP  a guardrail has tripped (kill switch, stop-loss, daily loss limit, max bets, stake above the cap);
//   WAIT  fewer than MIN_ROUNDS rounds ("collecting rounds (n/10)", no estimate), or from DATA_ROUNDS rounds the
//         rounds do not fit JetX's published odds (bad data), or the estimate is below minChance;
//   BET   the estimate is at least minChance. Still an estimate: the next round can crash below the target.
const M = require('./math');
const { summary } = require('./stats');
const { evaluate, STRATEGIES } = require('./strategies');

const MIN_ROUNDS = 10;
const DATA_ROUNDS = 300;
const MIN_TEST_BETS = 100;
const MIN_DISTINCT = 10;
const PRIOR = 10;
const DEFAULT_MIN_CHANCE = 0.8;
const NOTE = 'Not a prediction or a guarantee. At about 97% RTP each round is independent; the estimate is the hit '
  + 'rate of your recorded rounds eased toward the published odds (or a tested rule’s rate on unseen rounds), and '
  + 'the next round can still crash below the target.';

const pc = (p) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`);
const x2 = (t) => `${Number(t).toFixed(2)}x`;

// The configured BET threshold (0..1); a bad or missing value falls back to the default.
function configured() {
  try {
    const v = Number(require('../../config').crash.betMinChance);
    return v > 0 && v <= 1 ? v : DEFAULT_MIN_CHANCE;
  } catch { return DEFAULT_MIN_CHANCE; }
}
const chanceOf = (v) => (Number(v) > 0 && Number(v) <= 1 ? Number(v) : configured());

// The chosen rule, when it has held up on unseen rounds and fires for the next round; else null.
function provenRule(stats, strat) {
  const sel = strat.rows.find((r) => r.id === strat.selected);
  if (!sel || sel.test.bets < MIN_TEST_BETS || !(sel.test.corrected_low > stats.break_even) || !sel.condition_now) {
    return null;
  }
  return sel;
}

function decide(stats, strat, xs, minChance = configured()) {
  const t = stats.target; const be = stats.break_even; const n = stats.rounds;
  const base = { rounds: n, target: t, baseline: stats.baseline, break_even: be, min_rounds: MIN_ROUNDS,
    min_chance: minChance };
  const wait = (reason, extra = {}, strategy = null) => ({ action: 'WAIT', reason, strategy,
    numbers: { ...base, ...extra } });
  if (n < MIN_ROUNDS) {
    return wait(`collecting rounds (${n}/${MIN_ROUNDS})`, { estimate: null, estimate_source: 'collecting' });
  }
  const numbers = { ...base, hit_rate: stats.hit_rate.rate, low: stats.hit_rate.low, high: stats.hit_rate.high,
    min_test_bets: MIN_TEST_BETS, tests: strat.tests };
  let sel = null;
  if (n >= DATA_ROUNDS) {
    const distinct = new Set(xs).size;
    if (distinct < MIN_DISTINCT || stats.distribution.fits === false) {
      const why = distinct < MIN_DISTINCT ? ` (only ${distinct} different multipliers)`
        : ` (fit test p = ${stats.distribution.p})`;
      return { action: 'WAIT', strategy: null, numbers: { ...numbers, distinct, fit_p: stats.distribution.p,
        estimate: null, estimate_source: 'bad_data' },
      reason: `The recorded rounds do not look like JetX’s published odds${why}, so any estimate would most likely `
        + 'come from missed or misread rounds. Colon will not bet on data it cannot trust.' };
    }
    sel = provenRule(stats, strat);
  }
  const hits = stats.hit_rate.hits;
  const est = sel ? M.round(sel.test.rate) : M.round((hits + PRIOR * stats.baseline) / (n + PRIOR));
  const info = sel ? { id: sel.id, name: sel.name, rule: sel.rule } : null;
  const extra = { estimate: est, estimate_source: sel ? 'rule' : 'measured',
    ...(sel ? { test_rounds: strat.test_rounds, test_bets: sel.test.bets, test_hits: sel.test.hits,
      test_rate: sel.test.rate, corrected_low: sel.test.corrected_low, roi: sel.test.roi,
      condition_now: sel.condition_now } : {}) };
  const from = sel ? `${sel.name} on ${sel.test.bets} unseen bets` : `${n} recorded rounds`;
  const odds = ` Published odds ${pc(stats.baseline)}; break-even ${pc(be)} at ${x2(t)}.`;
  if (est >= minChance) {
    return { action: 'BET', strategy: info, numbers: { ...numbers, ...extra },
      reason: `Estimated ${pc(est)} that the next round reaches ${x2(t)} (from ${from}), at or above the `
        + `${pc(minChance)} Colon needs. Still not a prediction: this round can crash below the target.${odds}` };
  }
  return { action: 'WAIT', strategy: info, numbers: { ...numbers, ...extra },
    reason: `Estimated ${pc(est)} that the next round reaches ${x2(t)} (from ${from}), below the ${pc(minChance)} `
      + `Colon needs to say BET.${odds}` };
}

function analyse(xs, target, { minChance } = {}) {
  const list = (xs || []).map(Number).filter((x) => Number.isFinite(x) && x >= 1);
  const stats = summary(list, target);
  const strategies = evaluate(list, target);
  return { stats, strategies, decision: decide(stats, strategies, list, chanceOf(minChance)) };
}

function verdict(analysis, rails) {
  const d = analysis ? analysis.decision : { action: 'WAIT', reason: 'No analysis yet.', strategy: null, numbers: {} };
  const out = { ...d, verdict: d.action, engine: true, note: NOTE };
  if (rails && rails.status !== 'ok') {
    return { ...out, action: 'STOP', verdict: 'STOP', strategy: null,
      reason: `${rails.reasons.map((r) => r.message).join(' ')} Colon stops until this is cleared in Settings.`,
      numbers: { ...d.numbers, guardrails: rails.reasons.map((r) => r.code) } };
  }
  return out;
}

module.exports = { analyse, verdict, decide, configured, MIN_ROUNDS, DATA_ROUNDS, MIN_TEST_BETS, MIN_DISTINCT, PRIOR,
  DEFAULT_MIN_CHANCE, NOTE, STRATEGIES, baseline: M.baseline };
