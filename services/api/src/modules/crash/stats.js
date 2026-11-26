// Crash Predictor step 4 (v0.36.0): descriptive statistics over the user's JetX rounds, oldest first. Everything is
// measured against the published model: a round reaches m with chance about 0.97 / m, independent of history.
//   summary(xs, target) -> { rounds, target, baseline, break_even, expected_return, negative_expectation, hit_rate,
//                            median, streaks, distribution, windows, runs }
//   breakEven(target)   -> the hit rate a bet at target needs just to break even (1 / target; 0.7692 at 1.30x)
//   streaks(hits, p)    -> current run and the longest runs below and above the target
//   distribution(xs)    -> six buckets with observed and expected shares, and a chi-square goodness-of-fit test
//   runsTest(hits)      -> Wald-Wolfowitz runs test: do hits and misses cluster more (or less) than chance?
const M = require('./math');
const D = require('./dist');

const r4 = (x) => (x == null || !Number.isFinite(x) ? null : M.round(x, 4));
const breakEven = (target) => r4(1 / Number(target));
const survival = (m) => (m <= 1 ? 1 : m === Infinity ? 0 : Math.min(1, M.RTP / m)); // model P(X >= m)

const BUCKETS = [[1, 1.2, '<1.2x'], [1.2, 1.5, '1.2–1.5x'], [1.5, 2, '1.5–2x'], [2, 5, '2–5x'], [5, 10, '5–10x'],
  [10, Infinity, '10x+']];
const GOF_MIN = 60; // rounds before the fit test runs (every expected bucket count >= 5)
const GOF_ALPHA = 0.001; // below this p, the recorded rounds do not look like JetX's published odds

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return r4(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

// Typical longest miss streak in n rounds with hit chance p (Schilling): log(n p) / log(1 / (1 - p)).
function typicalLongest(n, p) {
  if (!n || !(p > 0 && p < 1) || n * p <= 1) return null;
  return Math.round(Math.log(n * p) / Math.log(1 / (1 - p)));
}

function streaks(hits, p) {
  let longestBelow = 0; let longestAbove = 0; let run = 0; let prev = null;
  for (const h of hits) {
    run = h === prev ? run + 1 : 1; prev = h;
    if (h) longestAbove = Math.max(longestAbove, run); else longestBelow = Math.max(longestBelow, run);
  }
  return { current: prev == null ? null : { kind: prev ? 'above' : 'below', length: run },
    longest_below: longestBelow, longest_above: longestAbove,
    typical_longest_below: typicalLongest(hits.length, p), typical_longest_above: typicalLongest(hits.length, 1 - p),
    note: 'Long streaks are normal in a fair game: the typical longest streaks for this many rounds are shown.' };
}

function distribution(xs) {
  const n = xs.length;
  const buckets = BUCKETS.map(([lo, hi, label]) => {
    const count = xs.filter((x) => x >= lo && x < hi).length;
    const expected = survival(lo) - survival(hi);
    return { label, from: lo, to: hi === Infinity ? null : hi, count, share: n ? r4(count / n) : null,
      expected_share: r4(expected) };
  });
  if (n < GOF_MIN) {
    return { buckets, chi2: null, df: BUCKETS.length - 1, p: null, fits: null,
      read: `The fit test needs at least ${GOF_MIN} rounds.` };
  }
  const chi2 = buckets.reduce((t, b) => { const e = b.expected_share * n; return t + ((b.count - e) ** 2) / e; }, 0);
  const p = D.chiSquareP(chi2, BUCKETS.length - 1);
  const fits = p >= GOF_ALPHA;
  return { buckets, chi2: r4(chi2), df: BUCKETS.length - 1, p: r4(p), fits,
    read: fits ? 'The rounds fit JetX’s published odds (about 0.97 / m).'
      : 'The rounds do not fit JetX’s published odds. That usually means rounds were missed, doubled or misread, '
        + 'or the data is not JetX. Check the collector before trusting any number here.' };
}

function runsTest(hits) {
  const n = hits.length; const n1 = hits.filter(Boolean).length; const n2 = n - n1;
  if (n < 20 || !n1 || !n2) {
    return { runs: null, expected: null, z: null, p: null, independent: null,
      read: 'Not enough hits and misses yet to test whether rounds depend on each other.' };
  }
  let runs = 1;
  for (let i = 1; i < n; i += 1) if (hits[i] !== hits[i - 1]) runs += 1;
  const mu = (2 * n1 * n2) / n + 1;
  const v = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const z = v > 0 ? (runs - mu) / Math.sqrt(v) : 0;
  const p = D.twoSidedP(z);
  const independent = p >= 0.01;
  return { runs, expected: r4(mu), z: r4(z), p: r4(p), independent,
    read: independent ? 'Hits and misses look independent, as a fair game should.'
      : `Hits and misses ${z < 0 ? 'cluster' : 'alternate'} more than chance would (p = ${r4(p)}). In real JetX `
        + 'data this most often means missed or doubled rounds.' };
}

function windowOf(hits, last, target) {
  if (hits.length < last) return { last, rounds: hits.length, hit_rate: null };
  const part = hits.slice(-last);
  return { last, rounds: last, hit_rate: M.hitRate(part.filter(Boolean).length, last, target) };
}

function summary(xs, target) {
  const t = Number(target); const n = xs.length;
  const base = M.baseline(t); const be = breakEven(t);
  const hits = xs.map((x) => x >= t);
  const h = hits.filter(Boolean).length;
  const rate = M.hitRate(h, n, t);
  const range = M.wilson(h, n);
  return {
    rounds: n, target: t, baseline: base, break_even: be, expected_return: M.expectedReturn(t),
    negative_expectation: base < be,
    expectation_note: base < be ? `The baseline ${base} is below break-even ${be}: betting every round at this `
      + 'target loses money on average.' : 'At this target the baseline is not below break-even.',
    hit_rate: { ...rate, above_break_even: range ? range.low > be : null },
    median: median(xs),
    streaks: streaks(hits, base),
    distribution: distribution(xs),
    windows: [windowOf(hits, 50, t), windowOf(hits, 200, t)],
    runs: runsTest(hits),
  };
}

module.exports = { summary, breakEven, streaks, distribution, runsTest, median, survival, BUCKETS, GOF_ALPHA };
