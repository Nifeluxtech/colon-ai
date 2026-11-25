// Unit tests for the Crash Predictor (v0.33.0, step 1): the honest baseline math, settings validation (demo mode on
// by default, the real-money confirmation, guardrail bounds), the guardrail state and the dashboard summary.
const test = require('node:test');
const assert = require('node:assert/strict');
const crash = require('../../src/modules/crash');
const { baseline, expectedReturn, wilson, hitRate } = crash.math;
const { validate, guardrails, DEFAULTS, fromRow } = crash.settings;

const ada = { id: 1, name: 'Ada Obi', email: 'ada@example.com' };
const invalid = (field) => (e) => e.status === 422 && e.code === 'invalid' && e.field === field;

test('baseline: about 0.97 / target, capped at 1', () => {
  assert.equal(baseline(1.3), 0.7462);
  assert.equal(baseline(2), 0.485);
  assert.equal(baseline(1.01), 0.9604);
  assert.equal(baseline(100), 0.0097);
  assert.equal(baseline(1), 0.97);
  assert.equal(baseline(0.5), null);
  assert.equal(baseline('x'), null);
});

test('every bet loses about 3% on average, at any target', () => {
  for (const t of [1.01, 1.3, 2, 10, 100]) assert.ok(Math.abs(expectedReturn(t) + 0.03) < 0.001, `target ${t}`);
});

test('wilson range: none without rounds, narrows with more rounds, holds the measured rate', () => {
  assert.equal(wilson(0, 0), null);
  const few = wilson(15, 20);
  const many = wilson(750, 1000);
  assert.ok(few.low < 0.75 && few.high > 0.75);
  assert.ok(many.high - many.low < few.high - few.low);
  assert.ok(many.low > 0.72 && many.high < 0.78);
});

test('hitRate: a small sample overlaps the baseline (no edge shown); a big gap is called', () => {
  const small = hitRate(16, 20, 1.3);
  assert.deepEqual([small.rate, small.baseline, small.above], [0.8, 0.7462, null]);
  assert.equal(hitRate(900, 1000, 1.3).above, true);
  assert.equal(hitRate(500, 1000, 1.3).above, false);
  const none = hitRate(0, 0, 1.3);
  assert.deepEqual([none.rate, none.low, none.above], [null, null, null]);
});

test('defaults: 1.30x target, demo mode on, kill switch off', () => {
  const s = fromRow(null);
  assert.deepEqual([s.target_cashout, s.demo_mode, s.kill_switch, s.site_url], [1.3, true, false, null]);
  const row = fromRow({ target_cashout: '2.50', stake: '50.00', demo_mode: 0, kill_switch: 1, stake_cap: '100.00',
    stop_loss: '10.00', daily_loss_limit: '20.00', max_bets_per_session: 5, currency: 'NGN', site_url: null });
  assert.deepEqual([row.target_cashout, row.stake, row.demo_mode, row.kill_switch], [2.5, 50, false, true]);
});

test('validate: target cash-out must be 1.01x to 100x, rounded to cents', () => {
  assert.equal(validate({ target_cashout: '1.5' }).settings.target_cashout, 1.5);
  assert.equal(validate({ target_cashout: 1.304 }).settings.target_cashout, 1.3);
  for (const v of [1, 1.009, 100.01, 'abc', '', null, true]) {
    assert.throws(() => validate({ target_cashout: v }), invalid('target_cashout'), String(v));
  }
});

test('validate: guardrail bounds and stake not above the stake cap', () => {
  assert.throws(() => validate({ stake: 0 }), invalid('stake'));
  assert.throws(() => validate({ stake: -5 }), invalid('stake'));
  assert.throws(() => validate({ stake: 2000 }), invalid('stake'));   // default cap is 1000
  assert.equal(validate({ stake: 2000, stake_cap: 5000 }).settings.stake, 2000);
  assert.throws(() => validate({ stop_loss: 0 }), invalid('stop_loss'));
  assert.throws(() => validate({ daily_loss_limit: 'lots' }), invalid('daily_loss_limit'));
  assert.throws(() => validate({ max_bets_per_session: 0 }), invalid('max_bets_per_session'));
  assert.throws(() => validate({ max_bets_per_session: 2.5 }), invalid('max_bets_per_session'));
  assert.throws(() => validate({ max_bets_per_session: 501 }), invalid('max_bets_per_session'));
  assert.equal(validate({ currency: 'usd' }).settings.currency, 'USD');
  assert.throws(() => validate({ currency: 'naira' }), invalid('currency'));
  assert.throws(() => validate({ kill_switch: 'yes' }), invalid('kill_switch'));
  assert.throws(() => validate('nope'), (e) => e.status === 422);
});

test('validate: site URL is an http(s) address without a login in it', () => {
  assert.equal(validate({ site_url: 'example.bet/jetx' }).settings.site_url, 'https://example.bet/jetx');
  assert.equal(validate({ site_url: '  ' }).settings.site_url, null);
  for (const v of ['javascript:alert(1)', 'ftp://x.com', 'https://me:pw@x.com', 'not a url', 'localhost']) {
    assert.throws(() => validate({ site_url: v }), invalid('site_url'), v);
  }
});

test('validate: leaving demo mode needs confirm_real_money and shows the warning; changes are listed', () => {
  assert.throws(() => validate({ demo_mode: false }), (e) => e.status === 409 && e.code === 'confirm_real_money'
    && /breach its terms/.test(e.message) && /3%/.test(e.extra.warning));
  const r = validate({ demo_mode: false, confirm_real_money: true, stake: 200 });
  assert.equal(r.settings.demo_mode, false);
  assert.deepEqual(r.changes, { demo_mode: [true, false], stake: [100, 200] });
  // Already on real money: no new confirmation needed for other changes.
  assert.equal(validate({ stake: 50 }, r.settings).settings.demo_mode, false);
  assert.deepEqual(validate({}, DEFAULTS).changes, {});
});

test('guardrails: kill switch, stop-loss, daily limit and max bets stop betting', () => {
  const s = { ...DEFAULTS, stop_loss: 500, daily_loss_limit: 1000, max_bets_per_session: 3 };
  assert.equal(guardrails(s, { sessionBets: 1, sessionProfit: -100, todayProfit: -100 }).status, 'ok');
  const codes = (u, x = s) => guardrails(x, u).reasons.map((r) => r.code);
  assert.deepEqual(codes({}, { ...s, kill_switch: true }), ['kill_switch']);
  assert.deepEqual(codes({ sessionProfit: -500 }), ['stop_loss']);
  assert.deepEqual(codes({ todayProfit: -1000 }), ['daily_loss_limit']);
  assert.deepEqual(codes({ sessionBets: 3 }), ['max_bets']);
  assert.deepEqual(codes({ sessionProfit: 900, todayProfit: 900 }), []);
  assert.equal(guardrails(s, { sessionBets: 1 }).bets_left, 2);
});

test('dayStart follows the browser offset (Lagos is UTC+1, offset -60)', () => {
  const now = new Date('2026-11-25T23:30:00Z');   // 00:30 on the 26th in Lagos
  assert.equal(crash.dayStart(now, 0).toISOString(), '2026-11-25T00:00:00.000Z');
  assert.equal(crash.dayStart(now, -60).toISOString(), '2026-11-25T23:00:00.000Z');
});

test('settings: saved per user, every change audited, real money is its own audit event', async () => {
  const store = crash.memoryStore();
  const e = crash.create({ store });
  assert.equal((await e.getSettings(ada)).demo_mode, true);
  await e.updateSettings(ada, { target_cashout: 1.5 });
  await assert.rejects(e.updateSettings(ada, { demo_mode: false }), (x) => x.code === 'confirm_real_money');
  await e.updateSettings(ada, { demo_mode: false, confirm_real_money: true });
  await e.updateSettings(ada, { kill_switch: true });
  await e.updateSettings(ada, { kill_switch: true });   // no change: nothing audited
  assert.deepEqual(store._s.audit.map((a) => a.event), ['settings.updated', 'settings.updated', 'demo_mode.off',
    'settings.updated', 'kill_switch.on']);
  assert.equal((await e.getSettings({ id: 2 })).target_cashout, 1.3);
  await assert.rejects(e.getSettings(null), (x) => x.status === 401);
});

test('dashboard: today\'s rounds vs baseline, P/L, guardrails, and WAIT with too few rounds', async () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const at = (h) => new Date(`2026-11-25T${String(h).padStart(2, '0')}:00:00Z`);
  const rounds = [1.0, 1.2, 1.3, 2.5, 5].map((m, i) => ({ id: i + 1, user_id: 1, game: 'jetx', round_id: `r${i}`,
    multiplier: m, observed_at: at(i + 1), source: 'collector' }));
  rounds.push({ id: 9, user_id: 1, game: 'jetx', round_id: 'old', multiplier: 9, observed_at: new Date('2026-11-24'),
    source: 'csv' }, { id: 10, user_id: 2, game: 'jetx', round_id: 'x', multiplier: 3, observed_at: at(2) });
  const bets = [{ id: 1, user_id: 1, session_id: 7, game: 'jetx', stake: 100, target: 1.3, outcome: 'won',
    payout: 130, demo: 1, placed_at: at(3) }, { id: 2, user_id: 1, session_id: 7, game: 'jetx', stake: 100,
    target: 1.3, outcome: 'lost', payout: 0, demo: 1, placed_at: at(4) }];
  const store = crash.memoryStore({ rounds, bets, sessions: [{ id: 7, user_id: 1, game: 'jetx', demo: 1,
    started_at: at(2) }] });
  const d = await crash.create({ store, clock: () => now }).dashboard(ada);
  assert.deepEqual([d.today.hit_rate.rounds, d.today.hit_rate.hits, d.today.hit_rate.baseline], [5, 3, 0.7462]);
  assert.deepEqual([d.today.bets, d.today.wins, d.today.losses, d.today.profit], [2, 1, 1, -70]);
  assert.deepEqual([d.session.id, d.session.bets, d.session.profit, d.session.demo], ['7', 2, -70, true]);
  assert.equal(d.baseline.probability, 0.7462);
  assert.equal(d.guardrails.status, 'ok');
  assert.equal(d.verdict.action, 'WAIT');
  assert.equal(d.recent_rounds.length, 6);
  assert.equal(d.recent_rounds[0].round_id, 'r4');
  assert.equal(d.account.email, 'ada@example.com');
  await store.saveSettings(1, { ...DEFAULTS, kill_switch: true });
  assert.equal((await crash.create({ store, clock: () => now }).dashboard(ada)).verdict.action, 'STOP');
});
