// Crash Predictor 0.39.3: the guessed range, tuned so about 7 of 10 next rounds land inside it.
//   narrowest(window, level) -> { low, high } | null   the narrowest interval holding ceil(level * n) of the rounds
//   replay(xs, level) -> { hits, samples, coverage }   how often the round after each point fell inside the range
//                                                       shown before it (the last REPLAY rounds of xs)
//   calibrated(xs) -> { range, level, coverage_target, coverage_measured, samples }
// Start at level 70%; replay; if the replayed coverage is more than TOLERANCE off 70%, step the level by 5% toward
// it (bounds 50%..95%) and keep the level whose replayed coverage is closest to 70% (ties: the smaller step away
// from 70%). Below MIN_SAMPLES replayed rounds the level stays 70% and coverage_measured is what was seen (or null).
// The range for the next round is then the narrowest interval at that level over the newest WINDOW rounds.
// Display only, like the rest of guess.js: nothing in the verdict or auto-bet reads it.
const WINDOW = 30;
const MIN_ROUNDS = 10;
const REPLAY = 100;
const TARGET = 70;          // percent
const STEP = 5;
const LOW_LEVEL = 50;
const HIGH_LEVEL = 95;
const TOLERANCE = 0.05;
const MIN_SAMPLES = 20;

const r2 = (x) => Math.round(x * 100) / 100;

function narrowest(window, level) {
  const s = (window || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const k = Math.min(s.length, Math.max(1, Math.ceil(level * s.length - 1e-9)));
  let best = 0;
  for (let i = 1; i + k - 1 < s.length; i += 1) {
    if (s[i + k - 1] - s[i] < s[best + k - 1] - s[best] - 1e-12) best = i;
  }
  return { low: r2(s[best]), high: r2(s[best + k - 1]) };
}

function replay(xs, level) {
  let hits = 0;
  let samples = 0;
  for (let j = Math.max(MIN_ROUNDS, xs.length - REPLAY); j < xs.length; j += 1) {
    const r = narrowest(xs.slice(Math.max(0, j - WINDOW), j), level);
    samples += 1;
    if (xs[j] >= r.low && xs[j] <= r.high) hits += 1;
  }
  return { hits, samples, coverage: samples ? Math.round((hits / samples) * 1e4) / 1e4 : null };
}

function calibrated(xs) {
  const goal = TARGET / 100;
  let pct = TARGET;
  let rep = replay(xs, pct / 100);
  if (rep.samples >= MIN_SAMPLES && Math.abs(rep.coverage - goal) > TOLERANCE) {
    const dir = rep.coverage < goal ? STEP : -STEP;
    let best = { pct, rep };
    for (let p = pct + dir; p >= LOW_LEVEL && p <= HIGH_LEVEL; p += dir) {
      const r = replay(xs, p / 100);
      if (Math.abs(r.coverage - goal) < Math.abs(best.rep.coverage - goal) - 1e-9) best = { pct: p, rep: r };
      if ((dir > 0 && r.coverage >= goal) || (dir < 0 && r.coverage <= goal)) break; // crossed the target
    }
    ({ pct, rep } = best);
  }
  return { range: narrowest(xs.slice(-WINDOW), pct / 100), level: pct / 100, coverage_target: goal,
    coverage_measured: rep.coverage, samples: rep.samples };
}

module.exports = { narrowest, replay, calibrated, WINDOW, REPLAY, TARGET, STEP, LOW_LEVEL, HIGH_LEVEL, TOLERANCE,
  MIN_SAMPLES };
