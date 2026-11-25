// Crash Predictor step 4 (v0.36.0): the analysis engine. It measures the user's JetX rounds against the published
// odds and tests a few transparent rules on rounds they have not seen. It never predicts a round.
//   analyse(xs, target) -> { stats, strategies, decision }   (xs: multipliers, oldest first)
//   verdict(analysis, rails) -> { action, verdict, reason, strategy, numbers, engine: true, note }
// The verdict, in order:
//   STOP  a guardrail has tripped (kill switch, stop-loss, daily loss limit, max bets, stake above the cap);
//   WAIT  fewer than MIN_ROUNDS rounds, or the rounds do not fit JetX's published odds (bad data), or the rule the
//         earlier rounds chose has fewer than MIN_TEST_BETS bets in the later rounds, or its corrected lower 95%
//         bound on the later rounds is not above break-even (1 / target), or its condition is false right now;
//   BET   only when all of those hold: the chosen rule's corrected lower bound on unseen rounds is above
//         break-even AND its condition is true for the next round.
const M = require('./math');
const { summary } = require('./stats');
const { evaluate, STRATEGIES } = require('./strategies');

const MIN_ROUNDS = 300;
const MIN_TEST_BETS = 100;
const MIN_DISTINCT = 10;
const NOTE = 'Not a prediction or a guarantee. At about 97% RTP each round is independent; Colon only says BET when '
  + 'a rule has beaten break-even on rounds it had not seen, and the next round can still crash below the target.';

const pc = (p) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`);
const x2 = (t) => `${Number(t).toFixed(2)}x`;

function decide(stats, strat, xs) {
  const t = stats.target; const be = stats.break_even;
  const numbers = { rounds: stats.rounds, target: t, baseline: stats.baseline, break_even: be,
    hit_rate: stats.hit_rate.rate, low: stats.hit_rate.low, high: stats.hit_rate.high, min_rounds: MIN_ROUNDS,
    min_test_bets: MIN_TEST_BETS, tests: strat.tests };
  const wait = (reason, extra = {}, strategy = null) => ({ action: 'WAIT', reason, strategy,
    numbers: { ...numbers, ...extra } });
  if (!stats.rounds) {
    return wait('No rounds recorded yet. Open JetX in the Colon JetX app, or import a CSV, so there is something '
      + 'to measure.');
  }
  if (stats.rounds < MIN_ROUNDS) {
    return wait(`Only ${stats.rounds} rounds recorded. Colon tests rules once it has at least ${MIN_ROUNDS}; until `
      + `then the honest odds apply: ${pc(stats.baseline)} per round at ${x2(t)}, below the ${pc(be)} a bet needs.`);
  }
  const distinct = new Set(xs).size;
  if (distinct < MIN_DISTINCT || stats.distribution.fits === false) {
    const why = distinct < MIN_DISTINCT ? ` (only ${distinct} different multipliers)`
      : ` (fit test p = ${stats.distribution.p})`;
    return wait(`The recorded rounds do not look like JetX’s published odds${why}`
      + ', so any edge would most likely come from missed or misread rounds. Colon will not bet on data it cannot '
      + 'trust.', { distinct, fit_p: stats.distribution.p });
  }
  const sel = strat.rows.find((r) => r.id === strat.selected);
  if (!sel) return wait('No rule had enough bets in the earlier rounds to be chosen yet.');
  const info = { id: sel.id, name: sel.name, rule: sel.rule };
  const extra = { test_rounds: strat.test_rounds, test_bets: sel.test.bets, test_hits: sel.test.hits,
    test_rate: sel.test.rate, corrected_low: sel.test.corrected_low, roi: sel.test.roi,
    condition_now: sel.condition_now };
  if (sel.test.bets < MIN_TEST_BETS) {
    return wait(`The rule the earlier rounds chose (${sel.name}) has only ${sel.test.bets} bets in the later, unseen `
      + `rounds. Colon needs at least ${MIN_TEST_BETS} before trusting it.`, extra, info);
  }
  if (!(sel.test.corrected_low > be)) {
    return wait(`No proven edge. The rule the earlier rounds chose (${sel.name}) hit ${pc(sel.test.rate)} on `
      + `${sel.test.bets} unseen bets; its cautious lower bound ${pc(sel.test.corrected_low)} is not above the `
      + `${pc(be)} break-even at ${x2(t)}. That is what a fair game looks like.`, extra, info);
  }
  if (!sel.condition_now) {
    return wait(`${sel.name} has held up on unseen rounds (lower bound ${pc(sel.test.corrected_low)} vs break-even `
      + `${pc(be)}), but its condition is not met for the next round. ${sel.rule}`, extra, info);
  }
  return { action: 'BET', strategy: info, numbers: { ...numbers, ...extra },
    reason: `${sel.name}: on ${sel.test.bets} unseen bets it hit ${pc(sel.test.rate)}; even its cautious lower bound `
      + `${pc(sel.test.corrected_low)} is above the ${pc(be)} break-even at ${x2(t)}, and its condition holds for `
      + 'the next round. Still not a prediction: this round can crash below the target.' };
}

function analyse(xs, target) {
  const list = (xs || []).map(Number).filter((x) => Number.isFinite(x) && x >= 1);
  const stats = summary(list, target);
  const strategies = evaluate(list, target);
  return { stats, strategies, decision: decide(stats, strategies, list) };
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

module.exports = { analyse, verdict, decide, MIN_ROUNDS, MIN_TEST_BETS, MIN_DISTINCT, NOTE, STRATEGIES,
  baseline: M.baseline };
