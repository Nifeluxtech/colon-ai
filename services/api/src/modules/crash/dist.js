// Crash Predictor step 4 (v0.36.0): the few probability functions the analysis engine needs, in plain JS.
//   normalCdf(z)        -> P(Z <= z) for a standard normal (error below 1e-7)
//   normalQuantile(p)   -> z with normalCdf(z) = p (bisection; p in (0, 1))
//   zFor(alpha)         -> the two-sided critical z for a false-alarm rate alpha (0.05 -> 1.96)
//   chiSquareP(x, df)   -> P(chi-square with df degrees of freedom >= x), the goodness-of-fit p-value
//   twoSidedP(z)        -> 2 * P(Z >= |z|)

function erf(x) {
  // Abramowitz and Stegun 7.1.26 is 1.5e-7; a series below 2.5 tightens the middle where the tests live.
  const ax = Math.abs(x);
  if (ax < 2.5) {
    let term = ax; let sum = ax;
    for (let n = 1; n < 80; n += 1) {
      term *= (-ax * ax) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-16) break;
    }
    return Math.sign(x) * (2 / Math.sqrt(Math.PI)) * sum;
  }
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-ax * ax);
  return Math.sign(x) * y;
}

const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const twoSidedP = (z) => Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));

function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError('p must be between 0 and 1');
  let lo = -40; let hi = 40;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i += 1) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
const zFor = (alpha) => normalQuantile(1 - alpha / 2);

function lnGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) { y += 1; ser += c / y; }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// Regularized upper incomplete gamma Q(a, x) (Numerical Recipes: series below a + 1, continued fraction above).
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a; let del = 1 / a; let sum = del;
    for (let n = 0; n < 500; n += 1) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  }
  const tiny = 1e-300;
  let b = x + 1 - a; let c = 1 / tiny; let d = 1 / b; let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h);
}
const chiSquareP = (x, df) => gammaQ(df / 2, x / 2);

module.exports = { normalCdf, normalQuantile, zFor, chiSquareP, twoSidedP };
