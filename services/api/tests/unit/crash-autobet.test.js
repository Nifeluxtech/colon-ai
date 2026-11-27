// Unit tests for the Crash Predictor auto-bet (v0.38.0, step 5): the decision gate (verdict BET + every guardrail),
// real money only when the account is out of demo mode and the app asks for it, demo settlement against the next
// collected round, the user's own manual bets (read-only log), the kill switch and the audit trail. In-memory store.
const test = require('node:test');
const assert = require('node:assert/strict');
const crash = require('../../src/modules/crash');
const A = crash.autobetRules;
const S = crash.settings;

const ada = { id: 1, name: 'Ada Obi', email: 'ada@example.com' };
const T0 = Date.UTC(2026, 10, 26, 12, 0, 0);
const BET = { action: 'BET', reason: 'test rule holds' };
const WAIT = { action: 'WAIT', reason: 'no edge' };

function make({ verdict = BET, seed } = {}) {
  let now = T0;
  const store = crash.memoryStore(seed);
  const clock = () => new Date(now);
  const e = crash.create({ store, clock, verdictOf: verdict ? async (id, s, rails) => crash.verdictFor(rails, {
    decision: { ...verdict, strategy: null, numbers: {} } }) : null });
  return { store, e, tick: (ms) => { now += ms; }, at: () => now };
}
const round = (store, id, multiplier, t) => store.insertRounds(1, 'jetx', [{ round_id: id, multiplier,
  observed_at: new Date(t), source: 'collector' }]);
const events = (store) => store._s.audit.map((a) => a.event);
const rails0 = (s, use) => S.guardrails(s, use || {});

test('decide (pure): every refusal in order, and BET with clear guardrails allows', () => {
  const s = { ...S.DEFAULTS };
  const go = (o) => A.decide({ settings: s, rails: rails0(s), verdict: BET, control: 'ai', ...o });
  assert.equal(go({}).allow, true);
  assert.equal(go({}).demo, true);
  assert.equal(go({}).stake, 100);
  assert.equal(go({}).target, 1.3);
  assert.equal(go({ control: 'manual' }).code, 'manual_mode');
  assert.equal(go({ control: '' }).code, 'manual_mode');
  assert.equal(go({ control: 'shared' }).allow, true);
  const killed = { ...s, kill_switch: true };
  assert.equal(A.decide({ settings: killed, rails: rails0(killed), verdict: BET, control: 'ai' }).code,
    'kill_switch');
  assert.equal(go({ real: true }).code, 'real_money_off');
  assert.equal(go({ verdict: WAIT }).code, 'verdict_wait');
  assert.match(go({ verdict: WAIT }).reason, /not BET/);
  assert.equal(go({ verdict: { action: 'STOP', reason: 'x' } }).code, 'verdict_stop');
  assert.equal(go({ verdict: null }).code, 'verdict_wait');
  assert.equal(go({ pending: true }).code, 'pending_bet');
  assert.equal(go({}).allow && go({}).stake <= s.stake_cap, true);
  const capped = { ...s, stake: 1500 };
  assert.equal(A.decide({ settings: capped, rails: rails0(capped), verdict: BET, control: 'ai' }).code, 'stake_cap');
  assert.equal(go({ rails: rails0(s, { sessionProfit: -1950 }) }).code, 'stop_loss_near');
  assert.equal(go({ rails: rails0(s, { sessionProfit: -2000 }) }).code, 'stop_loss');
  assert.equal(go({ rails: rails0(s, { todayProfit: -4950 }) }).code, 'daily_limit_near');
  assert.equal(go({ rails: rails0(s, { todayProfit: -5000 }) }).code, 'daily_loss_limit');
  assert.equal(go({ rails: rails0(s, { sessionBets: 20 }) }).code, 'max_bets');
  const real = { ...s, demo_mode: false };
  const r = A.decide({ settings: real, rails: rails0(real), verdict: BET, control: 'ai', real: true });
  assert.equal(r.allow, true);
  assert.equal(r.mode, 'real');
  assert.equal(A.decide({ settings: real, rails: rails0(real), verdict: BET, control: 'ai' }).mode, 'demo');
});

test('decision refuses unless the verdict is BET (the real engine with no rounds says WAIT)', async () => {
  const { e, store } = make({ verdict: null });
  const d = await e.decide(ada, { control: 'ai' });
  assert.equal(d.allow, false);
  assert.equal(d.code, 'verdict_wait');
  assert.equal(d.bet, null);
  assert.equal(store._s.bets.length, 0);
  assert.deepEqual(events(store), ['autobet.decision']);
});

test('real money is refused unless the account left demo mode and the app asked for it', async () => {
  const { e, store } = make();
  assert.equal((await e.decide(ada, { control: 'ai', real: true })).code, 'real_money_off');
  await e.updateSettings(ada, { demo_mode: false, confirm_real_money: true });
  const d = await e.decide(ada, { control: 'ai', real: true });
  assert.equal(d.allow, true);
  assert.equal(d.mode, 'real');
  assert.equal(d.bet.demo, false);
  assert.equal(store._s.bets.length, 1);
  const r = await e.recordBet(ada, { source: 'auto', mode: 'real', control: 'ai' }).catch((x) => x);
  assert.equal(r.status, 409, 'the first bet is still pending');
  assert.equal(r.code, 'pending_bet');
});

test('demo bet: recorded at once, settled by the next collected round, demo balance moves', async () => {
  const { e, store, tick, at } = make();
  const d = await e.decide(ada, { control: 'ai', client_ref: 'b-1' });
  assert.equal(d.allow, true);
  assert.equal(d.bet.outcome, 'pending');
  assert.equal(d.bet.source, 'auto');
  const again = await e.decide(ada, { control: 'ai', client_ref: 'b-1' });
  assert.equal(again.duplicate, true, 'a retried decision does not bet twice');
  assert.equal((await e.decide(ada, { control: 'ai' })).code, 'pending_bet');
  await round(store, 'old', 1.0, at() - 1000); // a round that ended before the bet does not settle it
  tick(9000);
  await round(store, 'r1', 1.29, at());
  let st = await e.autobetState(ada);
  assert.equal(st.bets[0].outcome, 'lost');
  assert.equal(st.bets[0].multiplier, 1.29);
  assert.equal(st.demo_balance.balance, A.DEMO_START - 100);
  tick(1000);
  await e.decide(ada, { control: 'ai' });
  tick(9000);
  await round(store, 'r2', 1.3, at());
  st = await e.autobetState(ada);
  assert.equal(st.bets[0].outcome, 'won');
  assert.equal(st.bets[0].payout, 130);
  assert.equal(st.demo_balance.balance, A.DEMO_START - 100 + 30);
  assert.equal(st.stats.auto.settled, 2);
  assert.equal(st.stats.auto.hit_rate, 0.5);
  assert.equal(st.stats.auto.baseline, 0.7462);
  assert.equal(st.stats.auto.break_even, 0.7692);
  assert.equal(st.honest.break_even, 0.7692);
  assert.ok(events(store).includes('bet.placed') && events(store).includes('bet.settled'));
});

test('a demo bet with no round in 10 minutes is void; the app cannot say how a demo bet went', async () => {
  const { e, tick } = make();
  const d = await e.decide(ada, { control: 'ai' });
  const r = await e.settleBet(ada, d.bet.id, { cashout: 5 }).catch((x) => x);
  assert.equal(r.code, 'demo_settles_itself');
  tick(A.SETTLE_MS + 1000);
  const st = await e.autobetState(ada);
  assert.equal(st.bets[0].outcome, 'void');
  assert.equal(st.demo_balance.balance, A.DEMO_START);
});

test('guardrails trip through the service: stop-loss, max bets, daily limit, kill switch', async () => {
  const { e, store, tick, at } = make();
  await e.updateSettings(ada, { stop_loss: 250, max_bets_per_session: 3, daily_loss_limit: 1000 });
  for (let i = 0; i < 3; i++) {
    const d = await e.decide(ada, { control: 'ai' });
    if (!d.allow) { assert.equal(d.code, 'stop_loss_near'); break; }
    tick(5000); await round(store, `r${i}`, 1.05, at()); tick(1000);
  }
  let d = await e.decide(ada, { control: 'ai' });
  assert.equal(d.allow, false);
  assert.ok(['stop_loss', 'stop_loss_near'].includes(d.code), d.code);
  await e.updateSettings(ada, { stop_loss: 100000, daily_loss_limit: 100000 });
  d = await e.decide(ada, { control: 'ai' });
  if (d.allow) {
    tick(5000); await round(store, 'rx', 2, at()); tick(1000);
    d = await e.decide(ada, { control: 'ai' });
  }
  assert.equal(d.code, 'max_bets');
  await e.updateSettings(ada, { max_bets_per_session: 500, daily_loss_limit: 150 }); // 170 lost today
  assert.equal((await e.decide(ada, { control: 'ai' })).code, 'daily_loss_limit');
  await e.updateSettings(ada, { daily_loss_limit: 100000 });
  assert.equal((await e.decide(ada, { control: 'ai' })).allow, true);
  tick(5000); await round(store, 'ry', 2, at()); tick(1000);
  const s = await e.stopAll(ada);
  assert.equal(s.kill_switch, true);
  d = await e.decide(ada, { control: 'ai' });
  assert.equal(d.code, 'kill_switch');
  assert.ok(events(store).includes('kill_switch.on'));
  assert.ok(events(store).filter((x) => x === 'autobet.decision').length >= 6, 'every decision audited');
});

test('demo losses never use up the real-money guardrails', async () => {
  const { e, store, tick, at } = make();
  await e.updateSettings(ada, { daily_loss_limit: 150 });
  await e.decide(ada, { control: 'ai' });
  tick(5000); await round(store, 'r1', 1.01, at()); tick(1000);
  assert.equal((await e.decide(ada, { control: 'ai' })).code, 'daily_limit_near', '100 lost, 100 more could pass');
  await e.updateSettings(ada, { daily_loss_limit: 100 });
  assert.equal((await e.decide(ada, { control: 'ai' })).code, 'daily_loss_limit');
  await e.updateSettings(ada, { demo_mode: false, confirm_real_money: true });
  assert.equal((await e.decide(ada, { control: 'ai', real: true })).allow, true);
});

test('dry run (Shared mode asks first) records nothing; the confirm records the bet', async () => {
  const { e, store } = make();
  const dry = await e.decide(ada, { control: 'shared', dry_run: true });
  assert.equal(dry.allow, true);
  assert.equal(dry.bet, null);
  assert.equal(store._s.bets.length, 0);
  const ok = await e.decide(ada, { control: 'shared' });
  assert.equal(ok.bet.outcome, 'pending');
});

test('manual bets: logged read-only, never gated, settled from what the app saw, deduped by ref', async () => {
  const { e, store, tick, at } = make({ verdict: WAIT });
  await e.stopAll(ada);
  const won = await e.recordBet(ada, { source: 'manual', stake: 200, target: 1.5, cashout: 1.5, client_ref: 'm1' });
  assert.equal(won.bet.source, 'manual');
  assert.equal(won.bet.outcome, 'won');
  assert.equal(won.bet.payout, 300);
  assert.equal(won.bet.mode, 'real');
  assert.equal((await e.recordBet(ada, { source: 'manual', stake: 200, client_ref: 'm1' })).duplicate, true);
  const open = await e.recordBet(ada, { source: 'manual', stake: 50, target: 2 });
  assert.equal(open.bet.outcome, 'pending');
  tick(8000); await round(store, 'r1', 2.5, at());
  const st = await e.autobetState(ada);
  assert.equal(st.bets.find((b) => b.id === open.bet.id).outcome, 'won');
  const noTarget = await e.recordBet(ada, { source: 'manual', stake: 10 });
  const s2 = await e.settleBet(ada, noTarget.bet.id, { outcome: 'lost' });
  assert.equal(s2.bet.outcome, 'lost');
  assert.equal((await e.settleBet(ada, noTarget.bet.id, { outcome: 'lost' }).catch((x) => x)).code, 'settled');
  assert.equal((await e.settleBet(ada, '99999', { outcome: 'lost' }).catch((x) => x)).status, 404);
  for (const bad of [{ stake: 0 }, { stake: 'x' }, { stake: 5, mode: 'fun' }, { stake: 5, target: 0.5 },
    { stake: 5, client_ref: 'a b' }, { stake: 5, placed_at: '2020-01-01' }, { stake: 5, outcome: 'maybe' }]) {
    assert.equal((await e.recordBet(ada, { source: 'manual', ...bad }).catch((x) => x)).status, 422,
      JSON.stringify(bad));
  }
  assert.equal((await e.recordBet(ada, { source: 'robot', stake: 5 }).catch((x) => x)).status, 422);
  assert.ok(events(store).includes('bet.manual'));
  assert.equal(st.stats.manual.bets >= 2, true);
});

test('settleWith and roundFor: the next round after the bet, cash-out above the crash refused', () => {
  const bet = { stake: 100, target: 1.3, placed_at: new Date(T0) };
  assert.equal(A.settleWith(bet, { multiplier: 1.3 }).outcome, 'won');
  assert.equal(A.settleWith(bet, { multiplier: 1.29 }).payout, 0);
  assert.equal(A.settleWith(bet, {}), null, 'nothing to settle from');
  assert.equal(A.settleWith(bet, { outcome: 'void' }).payout, 100);
});

test('roundFor picks the earliest round after placement within the window', () => {
  const bet = { placed_at: new Date(T0) };
  const r = (id, dt) => ({ id, observed_at: new Date(T0 + dt) });
  assert.equal(A.roundFor(bet, [r(3, 20000), r(2, 9000), r(1, -500)]).id, 2);
  assert.equal(A.roundFor(bet, [r(1, -500), r(4, A.SETTLE_MS + 1)]), null);
  assert.throws(() => A.settleWith({ stake: 1, target: 1.3 }, { cashout: 2, multiplier: 1.5 }), /cash-out/);
});

test('GET state honesty: notice never claims a guarantee; the 1.35x minimum auto-collect is mentioned', async () => {
  const { e } = make({ verdict: WAIT });
  const st = await e.autobetState(ada);
  assert.equal(st.mode, 'demo');
  assert.equal(st.decision_now.allow, false);
  assert.match(st.notice, /Not a prediction or a guarantee/);
  assert.match(st.honest.min_auto_note, /1\.35x/);
  assert.doesNotMatch(JSON.stringify(st), /guaranteed win|sure win|100% accurate/i);
});

test('live view: no estimate before 10 rounds (never the baseline in its place), then the engine’s', async () => {
  const { e, store, at } = make({ verdict: WAIT });
  await round(store, 'a', 1.5, at() - 20000);
  await round(store, 'b', 1.1, at() - 10000);
  const v = await e.live(ada);
  assert.equal(v.target, 1.3);
  assert.equal(v.estimate.chance, null);
  assert.equal(v.estimate.source, 'collecting');
  assert.equal(v.estimate.baseline, 0.7462);
  assert.equal(v.estimate.break_even, 0.7692);
  assert.equal(v.verdict.action, 'WAIT');
  assert.deepEqual(v.recent.map((r) => [r.multiplier, r.hit]), [[1.1, false], [1.5, true]]);
  const real = await crash.create({ store, clock: () => new Date(at()) }).live(ada);
  assert.deepEqual([real.estimate.chance, real.estimate.rounds, real.estimate.min_rounds], [null, 2, 10]);
  assert.equal(real.verdict.reason, 'collecting rounds (2/10)');
  assert.match(real.estimate.label, /collecting rounds \(2\/10\)/);
  const m = A.estimate({ action: 'WAIT', numbers: { rounds: 40, min_rounds: 10, estimate: 0.76543,
    estimate_source: 'measured', min_chance: 0.8 } }, 1.3);
  assert.deepEqual([m.chance, m.source, m.min_chance], [0.7654, 'measured', 0.8]);
  assert.match(m.label, /Estimate.*Not a guarantee/);
  const bet = A.estimate({ action: 'BET', numbers: { rounds: 900, estimate: 0.91234, estimate_source: 'rule' } }, 1.3);
  assert.deepEqual([bet.chance, bet.source], [0.9123, 'rule']);
  assert.equal(A.estimate({ action: 'STOP', numbers: { rounds: 3 } }, 2).chance, null);
  assert.doesNotMatch(JSON.stringify([v, real, m]), /low confidence/i);
});
