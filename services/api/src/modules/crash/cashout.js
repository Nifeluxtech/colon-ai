// Crash Predictor 0.39.4: the cash-out line on the Colon JetX bubble and the Live page, in place of 0.39.3's guessed
// range. Display only: the verdict, the 80% BET rule and auto-bet (which keeps the user's own target) never read it.
//   cashout(xs, { minChance }) -> { at, chance, source, min_chance, label, rounds, min_rounds, baseline }
//     xs: stored multipliers, oldest first (the same newest 5,000 the analysis engine reads).
// For each candidate cash-out multiplier (CANDIDATES: 1.05x..3x by 0.05, ..5x by 0.25, ..10x by 0.5) the engine
// itself (engine.analyse with that candidate as the target) estimates the chance that the NEXT round reaches it:
//   'measured'  the hit rate of the rounds eased toward 0.97 / m by 10 pseudo-rounds, or
//   'rule'      a rule's hit rate on rounds it had not seen (chronological split, Bonferroni-corrected, 300+ rounds,
//               data fit the published odds, 100+ unseen bets, firing now): exactly the engine's own path, nothing
//               here fits on the rounds it reports.
// at: the highest candidate of at least MIN_AT (1.10x) whose estimate is >= min_chance (CRASH_CASHOUT_MIN_CHANCE,
// default 0.75) -> "Cash out at 1.20x · 75%+". Else at null and "Don't bet · not sure enough": no candidate reaches
// it, or the rounds do not fit the published odds (source bad_data). Under 10 rounds: "3/10 rounds" (collecting).
// chance is the estimate at `at`, or at 1.10x when there is no `at` (null when collecting or bad_data). 'baseline'
// (the bare 0.97 / m) is never returned as the chance; `baseline` is shown beside it for the chosen multiplier.
// Each JetX round is independent; this is an estimate from past rounds, never a prediction or a guarantee.
const E = require('./engine');
const M = require('./math');

const MIN_AT = 1.1;
const DEFAULT_MIN_CHANCE = 0.75;
const CANDIDATES = Object.freeze((() => {
  const out = [];
  for (let c = 105; c <= 1000; c += c < 300 ? 5 : c < 500 ? 25 : 50) out.push(c / 100);
  return out;
})());
const NOT_SURE = 'Don’t bet · not sure enough';

const minChanceOf = (v) => (Number(v) > 0 && Number(v) <= 1 ? Number(v) : DEFAULT_MIN_CHANCE);
const pc0 = (p) => `${Math.round(p * 100)}%`;

function cashout(xs, { minChance } = {}) {
  const list = (xs || []).map(Number).filter((x) => Number.isFinite(x) && x >= 1);
  const min = minChanceOf(minChance);
  const n = list.length;
  const base = { min_chance: min, rounds: n, min_rounds: E.MIN_ROUNDS };
  if (n < E.MIN_ROUNDS) {
    return { at: null, chance: null, source: 'collecting', ...base, baseline: null,
      label: `${n}/${E.MIN_ROUNDS} rounds` };
  }
  let best = null;
  let first = null;
  for (const m of CANDIDATES) {
    const d = E.analyse(list, m, { minChance: min }).decision.numbers;
    if (d.estimate_source === 'bad_data') {
      return { at: null, chance: null, source: 'bad_data', ...base, baseline: null, label: NOT_SURE };
    }
    const row = { at: m, chance: d.estimate, source: d.estimate_source };
    if (m >= MIN_AT && !first) first = row;
    if (m >= MIN_AT && d.estimate != null && d.estimate >= min) best = row;
  }
  const pick = best || first;
  return { at: best ? best.at : null, chance: pick.chance, source: pick.source, ...base,
    baseline: M.round(M.baseline(pick.at)),
    label: best ? `Cash out at ${best.at.toFixed(2)}x · ${pc0(min)}+` : NOT_SURE };
}

// Per-user cache keyed on the round count, newest round id and the threshold (the scan runs ~58 analyses).
function cashoutCache({ max = 500 } = {}) {
  const cache = new Map();
  return function cached(userId, meta, xsOf, opts = {}) {
    const key = [meta.n, meta.max_id, minChanceOf(opts.minChance)].join(':');
    const hit = cache.get(userId);
    if (hit && hit.key === key) return hit.value;
    return Promise.resolve(xsOf()).then((xs) => {
      const value = cashout(xs, opts);
      cache.delete(userId);
      cache.set(userId, { key, value });
      if (cache.size > max) cache.delete(cache.keys().next().value);
      return value;
    });
  };
}

module.exports = { cashout, cashoutCache, minChanceOf, CANDIDATES, MIN_AT, DEFAULT_MIN_CHANCE, NOT_SURE };
