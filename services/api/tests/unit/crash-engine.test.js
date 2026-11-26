// Unit tests for the Crash Predictor analysis engine (v0.36.0, step 4): the probability helpers, the statistics, the
// out-of-sample rule tests and the BET / WAIT / STOP verdict. Synthetic rounds come from a seeded RNG: fair rounds
// follow JetX's published odds (P(X >= m) = 0.97 / m, independent), so the engine must never say BET on them.
const test = require('node:test');
const assert = require('node:assert/strict');
const crash = require('../../src/modules/crash');
const D = require('../../src/modules/crash/dist');
const S = require('../../src/modules/crash/stats');
const { STRATEGIES, evaluate } = require('../../src/modules/crash/strategies');

const E = crash.engine;
const ada = { id: 1, name: 'Ada Obi', email: 'ada@example.com' };

function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// One round: 0.97 / U shown to 2 decimals (rounded down), at least 1.00x.
const draw = (r, rtp = 0.97) => Math.max(1, Math.min(1e6, Math.floor((rtp / (1 - r())) * 100) / 100));
const fair = (seed, n, rtp) => { const r = rng(seed); return Array.from({ length: n }, () => draw(r, rtp)); };
// Deliberately biased: after a round below 1.30x the next reaches it 95% of the time (67.65% after a hit), so the
// long-run hit rate and the distribution still match the published odds; only the dependence is planted.
function biased(seed, n, t = 1.3) {
  const r = rng(seed); const xs = []; let prev = true;
  for (let i = 0; i < n; i += 1) {
    const hit = r() < (prev ? 0.6765 : 0.95);
    let m;
    if (hit) m = Math.floor((t / (1 - r())) * 100) / 100;
    else do { m = draw(r); } while (m >= t);
    xs.push(Math.min(m, 1e6)); prev = hit;
  }
  return xs;
}
const ok = { status: 'ok', reasons: [] };

test('dist: normal and chi-square helpers match their tables', () => {
  assert.ok(Math.abs(D.zFor(0.05) - 1.96) < 0.001);
  assert.ok(Math.abs(D.normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(D.chiSquareP(11.0705, 5) - 0.05) < 1e-3);
  assert.ok(Math.abs(D.chiSquareP(20.515, 5) - 0.001) < 1e-4);
  assert.ok(Math.abs(D.twoSidedP(2.5758) - 0.01) < 1e-4);
  assert.ok(D.zFor(0.005) > 2.8 && D.zFor(0.005) < 2.82);
});

test('stats: break-even, expected bucket shares, median and the negative expectation note', () => {
  assert.equal(S.breakEven(1.3), 0.7692);
  const d = S.distribution([]);
  assert.ok(Math.abs(d.buckets.reduce((t, b) => t + b.expected_share, 0) - 1) < 1e-3);
  assert.deepEqual(d.buckets.map((b) => b.expected_share), [0.1917, 0.1617, 0.1617, 0.291, 0.097, 0.097]);
  assert.equal(S.median([3, 1, 2, 10]), 2.5);
  const s = S.summary([1, 1.5, 2, 1.1, 1.2], 1.3);
  assert.equal(s.negative_expectation, true);
  assert.deepEqual([s.hit_rate.hits, s.hit_rate.rounds, s.streaks.current.kind, s.streaks.current.length],
    [2, 5, 'below', 2]);
  assert.deepEqual([s.streaks.longest_below, s.streaks.longest_above], [2, 2]);
  assert.equal(s.distribution.p, null);
});

test('stats: the runs test flags alternating rounds and passes fair ones', () => {
  const alt = Array.from({ length: 200 }, (_, i) => (i % 2 ? 2 : 1.1)).map((x) => x >= 1.3);
  assert.equal(S.runsTest(alt).independent, false);
  const f = fair(7, 3000).map((x) => x >= 1.3);
  assert.equal(S.runsTest(f).independent, true);
  assert.equal(S.runsTest([true, true]).p, null);
});

test('strategies: a rule reads only earlier rounds, never the round it judges', () => {
  const xs = fair(3, 400);
  const ctx = { target: 1.3, base: 0.7462 };
  for (const s of STRATEGIES) {
    for (const i of [0, 1, 5, 25, 399]) {
      const a = s.when(xs, i, ctx);
      const ys = [...xs]; ys[i] = ys[i] >= 1.3 ? 1 : 50;
      assert.equal(s.when(ys, i, ctx), a, `${s.id} at ${i}`);
    }
  }
  const ev = evaluate(xs, 1.3);
  assert.equal(ev.train_rounds + ev.test_rounds, 400);
  assert.equal(ev.tests, STRATEGIES.length);
  assert.equal(ev.rows.find((r) => r.id === 'always').test.bets, 200);
});

test('engine: fair rounds never get a BET, across seeds and sizes', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    for (const n of [300, 1200, 5000]) {
      const a = E.analyse(fair(seed, n), 1.3);
      assert.equal(a.decision.action, 'WAIT', `seed ${seed}, ${n} rounds: ${a.decision.reason}`);
    }
  }
  const two = E.analyse(fair(99, 3000), 2);
  assert.equal(two.decision.action, 'WAIT');
  assert.equal(two.stats.break_even, 0.5);
});

test('engine: a planted dependence is found on unseen rounds and gives BET when its condition holds', () => {
  for (const seed of [1, 2, 3]) {
    const xs = biased(seed, 3000); xs.push(1.0);
    const a = E.analyse(xs, 1.3);
    assert.equal(a.decision.action, 'BET', a.decision.reason);
    assert.ok(['after_1_below', 'after_instant'].includes(a.decision.strategy.id));
    assert.ok(a.decision.numbers.corrected_low > a.decision.numbers.break_even);
    assert.ok(a.decision.numbers.test_bets >= E.MIN_TEST_BETS);
    assert.match(a.decision.reason, /not a prediction/i);
    xs.push(2.5);
    const later = E.analyse(xs, 1.3);
    assert.equal(later.decision.action, 'WAIT');
    assert.match(later.decision.reason, /condition is not met/);
  }
});

test('engine: rounds that do not fit the published odds never get a BET', () => {
  const rich = E.analyse(fair(5, 3000, 1.25), 1.3); // every rule would look profitable
  assert.equal(rich.stats.distribution.fits, false);
  assert.equal(rich.decision.action, 'WAIT');
  assert.match(rich.decision.reason, /do not look like JetX/);
  const same = E.analyse(Array(600).fill(2), 1.3);
  assert.equal(same.decision.action, 'WAIT');
  assert.match(same.decision.reason, /only 1 different multipliers/);
  assert.equal(same.stats.runs.p, null);
});

test('engine: no rounds or too few rounds wait, with the numbers', () => {
  const none = E.verdict(E.analyse([], 1.3), ok);
  assert.deepEqual([none.action, none.verdict, none.engine, none.numbers.rounds], ['WAIT', 'WAIT', true, 0]);
  assert.match(none.reason, /No rounds recorded/);
  const few = E.verdict(E.analyse(fair(2, 120), 1.3), ok);
  assert.equal(few.action, 'WAIT');
  assert.match(few.reason, /Only 120 rounds/);
  assert.match(few.note, /Not a prediction/);
});

test('engine: a tripped guardrail is STOP, even when a rule has held up', () => {
  const xs = biased(1, 3000); xs.push(1.0);
  const a = E.analyse(xs, 1.3);
  const rails = crash.settings.guardrails({ ...crash.settings.DEFAULTS, kill_switch: true }, {});
  const v = E.verdict(a, rails);
  assert.deepEqual([v.action, v.verdict, v.strategy], ['STOP', 'STOP', null]);
  assert.match(v.reason, /Kill switch/);
  assert.deepEqual(v.numbers.guardrails, ['kill_switch']);
  const loss = crash.settings.guardrails(crash.settings.DEFAULTS, { sessionProfit: -2500 });
  assert.equal(E.verdict(a, loss).action, 'STOP');
  assert.equal(E.verdict(a, ok).action, 'BET');
});

const seed = (xs, from = Date.parse('2026-11-01T00:00:00Z')) => xs.map((m, i) => ({ id: i + 1, user_id: 1,
  game: 'jetx', round_id: `s${i}`, multiplier: m, observed_at: new Date(from + i * 10000), source: 'csv' }));

test('API: analysis and the dashboard verdict use the user’s own rounds, refreshed when rounds arrive', async () => {
  const xs = biased(2, 3000); xs.push(1.0);
  const store = crash.memoryStore({ rounds: seed(xs) });
  store._s.rounds.push(...seed(fair(1, 50)).map((r) => ({ ...r, id: r.id + 1e6, user_id: 2 })));
  const e = crash.create({ store, clock: () => new Date('2026-11-25T12:00:00Z') });
  const an = await e.analysis(ada);
  assert.deepEqual([an.analysed, an.total_rounds, an.limit, an.verdict.action], [3001, 3001, 5000, 'BET']);
  assert.ok(an.strategies.rows.length >= 8 && an.stats.distribution.buckets.length === 6);
  assert.match(an.notice, /Not a prediction/);
  const d = await e.dashboard(ada);
  assert.deepEqual([d.verdict.action, d.verdict.engine], ['BET', true]);
  await e.addRounds(ada, { source: 'manual', rounds: [{ multiplier: 3.2, ended_at: '2026-11-25T11:59:00Z' }] });
  assert.equal((await e.dashboard(ada)).verdict.action, 'WAIT');
  const small = await e.analysis(ada, { limit: 200 });
  assert.deepEqual([small.analysed, small.verdict.action], [200, 'WAIT']);
  const other = await e.analysis({ id: 2 });
  assert.deepEqual([other.analysed, other.verdict.action], [50, 'WAIT']);
  await assert.rejects(e.analysis(null), (x) => x.status === 401);
});
