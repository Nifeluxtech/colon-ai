// Unit tests for the Colon JetX cash-out line (0.39.4, modules/crash/cashout.js): for each candidate multiplier the
// analysis engine's own estimate of the chance the next round reaches it (measured, eased toward 0.97 / m, or a rule
// validated on unseen rounds); "Cash out at X · 75%+" for the highest candidate >= 1.10x at 75%, else "Don't bet ·
// not sure enough"; "n/10 rounds" below 10; bad data; GET /crash/live and /crash/analysis; the verdict and auto-bet
// never read it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crash = require('../../src/modules/crash');
const E = crash.engine;
const CO = crash.cashout;

const ada = { id: 1, name: 'Ada Obi', email: 'ada@example.com' };
const T0 = Date.UTC(2026, 10, 27, 9, 0, 0);

function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const draw = (r) => Math.max(1, Math.floor((0.97 / (1 - r())) * 100) / 100);
const fair = (seed, n) => { const r = rng(seed); return Array.from({ length: n }, () => draw(r)); };
// After a round below 1.30x the next reaches 1.30x 95% of the time (as in crash-engine.test.js).
function biased(seed, n, t = 1.3) {
  const r = rng(seed); const xs = []; let prev = true;
  for (let i = 0; i < n; i += 1) {
    const hit = r() < (prev ? 0.6765 : 0.95);
    let m;
    if (hit) m = Math.floor((t / (1 - r())) * 100) / 100;
    else do { m = draw(r); } while (m >= t);
    xs.push(m); prev = hit;
  }
  return xs;
}
// The engine's measured estimate, written out: (hits + 10 * 0.97 / m) / (n + 10).
const measured = (xs, m) => (xs.filter((x) => x >= m).length + 10 * (0.97 / m)) / (xs.length + 10);

test('candidates run from 1.05x to 10x in small steps', () => {
  assert.equal(CO.CANDIDATES[0], 1.05);
  assert.equal(CO.CANDIDATES[CO.CANDIDATES.length - 1], 10);
  assert.ok(CO.CANDIDATES.includes(1.1) && CO.CANDIDATES.includes(1.25) && CO.CANDIDATES.includes(2));
  for (let i = 1; i < CO.CANDIDATES.length; i += 1) assert.ok(CO.CANDIDATES[i] > CO.CANDIDATES[i - 1]);
});

test('below 10 rounds: no cash-out, "n/10 rounds"', () => {
  const c = CO.cashout([2, 3, 1.5]);
  assert.equal(c.at, null);
  assert.equal(c.chance, null);
  assert.equal(c.source, 'collecting');
  assert.equal(c.label, '3/10 rounds');
  assert.equal(CO.cashout(null).label, '0/10 rounds');
});

test('the highest candidate whose engine estimate is at least 75%', () => {
  const xs = Array(20).fill(2);
  const c = CO.cashout(xs);
  assert.equal(c.at, 2); // (20 + 10 * 0.485) / 30 = 82.8%; 2.05x: no round reached it
  assert.equal(c.chance, 0.8283);
  assert.equal(c.source, 'measured');
  assert.equal(c.min_chance, 0.75);
  assert.equal(c.label, 'Cash out at 2.00x · 75%+');
  assert.doesNotMatch(c.label, /predict/i);
  for (const seed of [1, 2, 3, 4, 5]) {
    const ys = fair(seed, 80);
    const d = CO.cashout(ys);
    const ok = CO.CANDIDATES.filter((m) => m >= 1.1 && measured(ys, m) >= 0.75 - 5e-5);
    assert.equal(d.at, ok.length ? ok[ok.length - 1] : null, `seed ${seed}`);
    if (d.at) assert.equal(d.chance, E.analyse(ys, d.at).decision.numbers.estimate);
  }
});

test('nothing at 1.10x or above reaches 75%: "Don\'t bet · not sure enough"', () => {
  const c = CO.cashout(Array(30).fill(1.05));
  assert.equal(c.at, null);
  assert.equal(c.source, 'measured');
  assert.equal(c.chance, E.analyse(Array(30).fill(1.05), 1.1).decision.numbers.estimate);
  assert.ok(c.chance < 0.75);
  assert.equal(c.label, 'Don’t bet · not sure enough');
  // 1.05x alone reaching 75% does not count: the line starts at 1.10x.
  assert.ok(E.analyse(Array(30).fill(1.05), 1.05).decision.numbers.estimate >= 0.75);
});

test('rounds that do not fit the published odds: bad_data, "Don\'t bet"', () => {
  const c = CO.cashout(Array(320).fill(1.5));
  assert.equal(c.at, null);
  assert.equal(c.chance, null);
  assert.equal(c.source, 'bad_data');
  assert.equal(c.label, 'Don’t bet · not sure enough');
});

test('fair rounds: a measured estimate, never a rule, and the threshold from config', () => {
  for (const seed of [1, 2, 3]) {
    const xs = fair(seed, 1200);
    const c = CO.cashout(xs);
    assert.equal(c.source, 'measured');
    assert.ok(c.at >= 1.1 && c.at <= 1.4, `seed ${seed}: ${c.at}`);
    assert.ok(c.chance >= 0.75);
    const strict = CO.cashout(xs, { minChance: 0.9 });
    assert.ok(strict.at == null || strict.at < c.at);
    assert.equal(strict.min_chance, 0.9);
  }
  assert.equal(CO.minChanceOf('x'), 0.75);
  assert.equal(CO.minChanceOf(2), 0.75);
});

test('a rule counts only through the engine\'s unseen-round test', () => {
  const xs = biased(1, 3000); xs.push(1.0); // the planted rule fires for the next round
  const at13 = E.analyse(xs, 1.3, { minChance: 0.75 }).decision.numbers;
  assert.equal(at13.estimate_source, 'rule');
  const c = CO.cashout(xs);
  assert.ok(c.at >= 1.3);
  const d = E.analyse(xs, c.at, { minChance: 0.75 }).decision.numbers;
  assert.equal(c.chance, d.estimate);
  assert.equal(c.source, d.estimate_source);
  if (c.source === 'rule') assert.ok(d.corrected_low > d.break_even && d.test_bets >= E.MIN_TEST_BETS);
});

function make({ cfg } = {}) {
  const store = crash.memoryStore();
  const e = crash.create({ store, clock: () => new Date(T0 + 3600000), cashoutCfg: () => cfg || {},
    verdictOf: async (id, s, rails) => crash.verdictFor(rails, { decision: { action: 'BET', reason: 'test',
      strategy: null, numbers: {} } }) });
  return { store, e };
}
const fill = (store, xs, tag = 'r') => store.insertRounds(1, 'jetx', xs.map((m, i) => ({ round_id: `${tag}${i}`,
  multiplier: m, observed_at: new Date(T0 + (tag === 'r' ? 0 : 1e6) + i * 10000), source: 'collector' })));

test('GET /crash/live and /crash/analysis carry cashout; no guess; the verdict is unchanged', async () => {
  const { store, e } = make();
  await fill(store, [1.2, 1.5]);
  let live = await e.live(ada);
  assert.equal(live.cashout.at, null);
  assert.equal(live.cashout.label, '2/10 rounds');
  await fill(store, Array(18).fill(2), 's');
  live = await e.live(ada);
  assert.equal(live.cashout.at, 2);
  assert.equal(live.cashout.label, 'Cash out at 2.00x · 75%+');
  assert.equal(live.verdict.action, 'BET');
  assert.equal(live.target, 1.3); // auto-bet keeps the user's own target
  assert.equal(live.guess, undefined);
  const an = await e.analysis(ada);
  assert.equal(an.cashout.at, 2);
  assert.equal(an.guess, undefined);
});

test('the decision never reads the cash-out line', async () => {
  const xs = fair(7, 60);
  const a = make({ cfg: { minChance: 0.75 } });
  const b = make({ cfg: { minChance: 0.99 } });
  await fill(a.store, xs);
  await fill(b.store, xs);
  const da = await a.e.decide(ada, { control: 'ai', dry_run: true });
  const db = await b.e.decide(ada, { control: 'ai', dry_run: true });
  assert.deepEqual([da.allow, da.target, da.stake], [db.allow, db.target, db.stake]);
  assert.equal(da.target, 1.3);
  assert.equal((await b.e.live(ada)).cashout.at, null);
});
