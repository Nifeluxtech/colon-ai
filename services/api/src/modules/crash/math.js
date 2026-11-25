// Crash Predictor: the honest math (docs/crash-predictor/HANDOFF.md §3). JetX returns about 97% (RTP), so a round
// reaches multiplier m with probability about 0.97 / m, every round, whatever came before. Each bet therefore
// loses about 3% of its stake on average. Nothing here predicts a round; it measures and compares.
//   baseline(target)        -> chance a round reaches target (0..1), e.g. 1.30x -> 0.7462
//   expectedReturn(target)  -> average result per 1 unit staked at the baseline (-0.03 at any target)
//   wilson(hits, n)         -> 95% confidence range for a measured hit rate, { low, high } (null when n = 0)
//   hitRate(hits, n)        -> measured rate with its range and the baseline it should be read against
const RTP = 0.97;
const Z95 = 1.959964;

const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

function baseline(target, rtp = RTP) {
  const t = Number(target);
  if (!Number.isFinite(t) || t < 1) return null;
  return round(Math.min(1, rtp / t));
}

function expectedReturn(target, rtp = RTP) {
  const p = baseline(target, rtp);
  return p == null ? null : round(p * Number(target) - 1);
}

function wilson(hits, n, z = Z95) {
  if (!n) return null;
  const p = hits / n;
  const z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: round(Math.max(0, mid - half)), high: round(Math.min(1, mid + half)) };
}

// above: the range sits wholly above the baseline (true), wholly below (false), or overlaps it (null: no difference
// shown). With few rounds the range is wide and overlaps, which is the honest answer.
function hitRate(hits, n, target) {
  const base = baseline(target);
  const range = wilson(hits, n);
  const above = !range || base == null ? null : range.low > base ? true : range.high < base ? false : null;
  return { rounds: n, hits, rate: n ? round(hits / n) : null, low: range ? range.low : null,
    high: range ? range.high : null, baseline: base, above };
}

module.exports = { RTP, baseline, expectedReturn, wilson, hitRate, round };
