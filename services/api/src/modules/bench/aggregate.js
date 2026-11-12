// Colon benchmark: per-set and overall statistics, and the weighted overall score (docs/phase-5-benchmark.md).
//
//   overall = 100 × (0.60 × accuracy + 0.15 × language + 0.10 × speed + 0.15 × reliability)
//
//   accuracy     mean of the per-set accuracies (every set counts equally; an error scores 0)
//   language     mean language quality on the Pidgin, Yorùbá, Hausa and Igbo sets (written in the right
//                language with its letters/tone marks; blended 50/50 with the LLM-judge score when one ran)
//   speed        median first-token time on a log scale: ≤1 s = 1, ≥20 s = 0
//   reliability  1 − error rate (errors after polite retries: timeouts, 4xx/5xx, empty replies)
// Cost is recorded (0 on the free tiers) and used only to break ties.
const LANGUAGE_SETS = ['pidgin', 'yoruba', 'hausa', 'igbo'];
const WEIGHTS = { accuracy: 0.60, language: 0.15, speed: 0.10, reliability: 0.15 };
const SPEED_BEST_MS = 1000, SPEED_WORST_MS = 20000;

function quantile(list, q) {
  const a = list.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round(a[lo] + (a[hi] - a[lo]) * (pos - lo));
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

function speedScore(ms) {
  if (!Number.isFinite(ms)) return 0;
  if (ms <= SPEED_BEST_MS) return 1;
  if (ms >= SPEED_WORST_MS) return 0;
  return Math.log(SPEED_WORST_MS / ms) / Math.log(SPEED_WORST_MS / SPEED_BEST_MS);
}

function summarize(rows) {
  const ok = rows.filter(r => !r.error);
  const lang = rows.filter(r => r.lang !== undefined && r.lang !== null).map(r => (r.error ? 0 : r.judge != null
    ? 0.5 * r.lang + 0.5 * r.judge : r.lang));
  return {
    n: rows.length,
    accuracy: r3(mean(rows.map(r => (r.error ? 0 : r.score || 0)))),
    correct: rows.filter(r => !r.error && r.pass).length,
    errors: rows.length - ok.length,
    error_rate: r3(rows.length ? (rows.length - ok.length) / rows.length : 0),
    language: lang.length ? r3(mean(lang)) : null,
    first_token_ms: { median: quantile(ok.map(r => r.first_token_ms), 0.5), p90: quantile(ok.map(r =>
      r.first_token_ms), 0.9) },
    total_ms: { median: quantile(ok.map(r => r.total_ms), 0.5), p90: quantile(ok.map(r => r.total_ms), 0.9) },
    tokens: rows.reduce((a, r) => a + (Number(r.tokens) || 0), 0),
    cost_usd: r3(rows.reduce((a, r) => a + (Number(r.cost_usd) || 0), 0)),
  };
}

/**
 * aggregate(rows) for ONE model -> { overall, score, components, sets: {set: summary} }
 * rows: [{ set, id, pass, score, lang?, judge?, first_token_ms, total_ms, error?, tokens?, cost_usd? }]
 */
function aggregate(rows) {
  const bySet = {};
  for (const r of rows) (bySet[r.set] = bySet[r.set] || []).push(r);
  const sets = Object.fromEntries(Object.keys(bySet).sort().map(s => [s, summarize(bySet[s])]));
  const overall = summarize(rows);
  const accuracy = mean(Object.values(sets).map(s => s.accuracy || 0)) || 0;
  const langVals = LANGUAGE_SETS.filter(s => sets[s] && sets[s].language !== null).map(s => sets[s].language);
  const language = langVals.length ? mean(langVals) : 0;
  const speed = speedScore(overall.first_token_ms.median);
  const reliability = 1 - (overall.error_rate || 0);
  const score = 100 * (WEIGHTS.accuracy * accuracy + WEIGHTS.language * language + WEIGHTS.speed * speed
    + WEIGHTS.reliability * reliability);
  return {
    score: Math.round(score * 10) / 10,
    components: { accuracy: r3(accuracy), language: r3(language), speed: r3(speed), reliability: r3(reliability) },
    overall, sets,
  };
}

// Ranks model summaries: higher score first, then lower cost, then faster median first token.
function rank(models) {
  return [...models].sort((a, b) => (b.score - a.score)
    || ((a.overall.cost_usd || 0) - (b.overall.cost_usd || 0))
    || ((a.overall.first_token_ms.median || Infinity) - (b.overall.first_token_ms.median || Infinity)));
}

module.exports = { aggregate, summarize, rank, quantile, speedScore, WEIGHTS, LANGUAGE_SETS };
