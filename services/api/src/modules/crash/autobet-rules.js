// Crash Predictor step 5 (v0.37.0): the auto-bet's pure rules (docs/crash-predictor/HANDOFF.md). No I/O.
//   decide({ settings, rails, verdict, control, real, pending }) -> { allow, code, reason, stake, target, demo }
//       The only gate before Colon JetX bets for the user. Refuses, in order: Manual control, the kill switch, real
//       money asked for while the account is in demo mode, any tripped guardrail (stop-loss, daily loss limit, max
//       bets, stake above the cap), a stake that could pass the stop-loss or the daily limit, a bet still waiting
//       for its round, and any verdict other than BET. Allows only when every check passes.
//   cleanManual(body, now)  -> a manual bet to store (the user's own Bet press, seen read-only by the app)
//   settleWith(bet, report) -> { outcome, payout, multiplier, cashout } or null (not enough to settle)
//   roundFor(bet, rounds)   -> the first round that ended after the bet was placed (within SETTLE_MS), or null
//   summarize(bets)         -> hit rate vs the bets' baseline (0.97 / target) and break-even (1 / target)
//   estimate(verdict, target) -> the estimated chance the next round reaches the target: the chosen rule's rate on
//                             unseen rounds when the verdict is BET, else the baseline 0.97 / target. An estimate.
// Nothing here predicts a round. A BET verdict only means a rule beat break-even on rounds it had not seen.
const M = require('./math');

const GAME = 'jetx';
const DEMO_START = 10000;            // the demo balance a new account starts with (simulated, never money)
const SETTLE_MS = 10 * 60 * 1000;    // a bet with no round within 10 minutes is void (stake back)
const PAST_MS = 10 * 60 * 1000;      // a reported bet time may be at most this old
const FUTURE_MS = 60 * 1000;
const CONTROLS = Object.freeze(['ai', 'shared']);
const SOURCES = Object.freeze(['auto', 'manual']);
const MODES = Object.freeze(['demo', 'real']);
const REF = /^[A-Za-z0-9_.:-]{1,64}$/;
const MIN_AUTO_NOTE = 'Some JetX rulesets set a minimum auto cash-out (auto-collect) of 1.35x; check your operator’s '
  + 'game rules. Below that the game may refuse the target.';
const NOTICE = 'Not a prediction or a guarantee. At about 97% RTP each bet loses about 3% of its stake on average; '
  + 'auto-bet only follows the analysis verdict and your guardrails, and the next round can always crash below the '
  + 'target.';

const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });
const bad = (field, message) => { throw err(422, 'invalid', message, field); };
const cents = (x) => Math.round(Number(x) * 100) / 100;
const money = (x) => Math.round(Number(x || 0) * 100) / 100;

const REASONS = {
  manual_mode: 'Control is set to Manual: Colon does not bet for you.',
  kill_switch: 'Kill switch is on: no bets.',
  real_money_off: 'Real money is off for this account (demo mode). Turn it on in Settings first; until then only '
    + 'demo bets are placed.',
  stop_loss_near: 'This stake could take the session past its stop-loss.',
  daily_limit_near: 'This stake could take today past the daily loss limit.',
  pending_bet: 'The last bet is still waiting for its round to finish.',
};

function decide({ settings: s, rails, verdict, control, real = false, pending = false }) {
  const demo = !(real === true && s.demo_mode === false);
  const out = (allow, code, reason) => ({ allow, code, reason, stake: allow ? money(s.stake) : 0,
    target: cents(s.target_cashout), demo, mode: demo ? 'demo' : 'real' });
  const no = (code, reason) => out(false, code, reason || REASONS[code]);
  if (!CONTROLS.includes(control)) return no('manual_mode');
  if (s.kill_switch) return no('kill_switch');
  if (real === true && s.demo_mode !== false) return no('real_money_off');
  if (!rails || rails.status !== 'ok') {
    const first = rails && rails.reasons && rails.reasons[0];
    return no(first ? first.code : 'guardrails', first ? first.message : 'Guardrails are not clear.');
  }
  if (s.stake > s.stake_cap) return no('stake_cap', 'Stake is above the stake cap.');
  if (s.stake > s.stop_loss - (rails.session_loss || 0) + 1e-9) return no('stop_loss_near');
  if (s.stake > (rails.loss_left_today == null ? Infinity : rails.loss_left_today) + 1e-9) {
    return no('daily_limit_near');
  }
  if (pending) return no('pending_bet');
  const action = verdict && (verdict.action || verdict.verdict);
  if (action !== 'BET') {
    return no(`verdict_${String(action || 'wait').toLowerCase()}`,
      `The verdict is ${action || 'WAIT'}, not BET. ${(verdict && verdict.reason) || ''}`.trim());
  }
  return out(true, 'bet', 'The verdict is BET and every guardrail is clear. Still not a guarantee.');
}

function num(field, v, lo, hi, label) {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/\s*[x×]$/i, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) bad(field, `Send ${label} as a number.`);
  if (n < lo || n > hi) bad(field, `${label[0].toUpperCase() + label.slice(1)} must be between ${lo} and ${hi}.`);
  return cents(n);
}
function timeOf(v, now) {
  if (v == null || v === '') return new Date(now);
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
  if (!Number.isFinite(t) || t < now.getTime() - PAST_MS || t > now.getTime() + FUTURE_MS) {
    bad('placed_at', 'The bet time is too far from now.');
  }
  return new Date(t);
}
function refOf(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!REF.test(s)) bad('client_ref', 'Bad bet reference.');
  return s;
}

// The user's own bet, as the app saw it: stake, the auto cash-out (target) when it was on, and, when known, the
// cash-out multiplier or the round's crash. Anything settled here is settled from what the user reported.
function cleanManual(body, now = new Date()) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : bad('bet', 'Send a bet.');
  const mode = b.mode == null ? 'real' : String(b.mode);
  if (!MODES.includes(mode)) bad('mode', 'Mode must be demo or real.');
  const stake = num('stake', b.stake, 0.01, 1e7, 'the stake');
  if (stake == null) bad('stake', 'Send the stake.');
  const target = num('target', b.target, 1.01, 10000, 'the target');
  const bet = { source: 'manual', demo: mode === 'demo', stake, target, placed_at: timeOf(b.placed_at, now),
    client_ref: refOf(b.client_ref) };
  const s = settleWith(bet, { multiplier: b.multiplier, cashout: b.cashout, outcome: b.outcome });
  return { ...bet, ...(s || { outcome: 'pending', payout: 0, multiplier: null, cashout: null }) };
}

// report: { multiplier?, cashout?, outcome? } from the round or the app. null when it can't be settled from it.
function settleWith(bet, report = {}) {
  const r = report || {};
  const m = num('multiplier', r.multiplier, 1, 1e6, 'the multiplier');
  const c = num('cashout', r.cashout, 1, 1e6, 'the cash-out');
  if (r.outcome != null && !['won', 'lost', 'void'].includes(r.outcome)) {
    bad('outcome', 'Outcome must be won, lost or void.');
  }
  const stake = Number(bet.stake);
  const target = bet.target == null ? null : Number(bet.target);
  if (r.outcome === 'void') return { outcome: 'void', payout: money(stake), multiplier: m, cashout: null };
  if (c != null) {
    if (m != null && c > m) bad('cashout', 'The cash-out can’t be above the round’s multiplier.');
    return { outcome: 'won', payout: money(stake * c), multiplier: m, cashout: c };
  }
  if (m != null && target != null) {
    const won = m >= target;
    return { outcome: won ? 'won' : 'lost', payout: won ? money(stake * target) : 0, multiplier: m,
      cashout: won ? target : null };
  }
  if (r.outcome === 'lost') return { outcome: 'lost', payout: 0, multiplier: m, cashout: null };
  if (r.outcome === 'won') bad('cashout', 'Send the cash-out multiplier for a won bet.');
  return null;
}

// rounds: any order. The first round seen after the bet was placed is the round it was for: the app bets right
// after a round ends, while the next one is open for bets.
function roundFor(bet, rounds) {
  const placed = new Date(bet.placed_at).getTime();
  return (rounds || []).filter((r) => {
    const t = new Date(r.observed_at).getTime();
    return t > placed && t <= placed + SETTLE_MS;
  }).sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at) || a.id - b.id)[0] || null;
}

// bets: settled and pending, any source and mode. Each group's hit rate is read against the average baseline
// (0.97 / target) and break-even (1 / target) of its own bets' targets.
function summarize(bets) {
  const group = (rows) => {
    const done = rows.filter((b) => b.outcome === 'won' || b.outcome === 'lost');
    const withT = done.filter((b) => b.target != null && Number(b.target) >= 1);
    const hits = done.filter((b) => b.outcome === 'won').length;
    const range = M.wilson(hits, done.length);
    const avg = (f) => (withT.length ? M.round(withT.reduce((t, b) => t + f(Number(b.target)), 0) / withT.length)
      : null);
    const staked = done.reduce((t, b) => t + Number(b.stake), 0);
    const profit = done.reduce((t, b) => t + Number(b.payout) - Number(b.stake), 0);
    return { bets: rows.length, settled: done.length, pending: rows.filter((b) => b.outcome === 'pending').length,
      hits, hit_rate: done.length ? M.round(hits / done.length) : null, low: range ? range.low : null,
      high: range ? range.high : null, baseline: avg((t) => M.baseline(t)), break_even: avg((t) => 1 / t),
      staked: money(staked), profit: money(profit) };
  };
  const by = (f) => group(bets.filter(f));
  return { all: group(bets), auto: by((b) => b.source !== 'manual'), manual: by((b) => b.source === 'manual'),
    demo: by((b) => Boolean(Number(b.demo))), real: by((b) => !Number(b.demo)) };
}

function estimate(verdict, target) {
  const n = (verdict && verdict.numbers) || {};
  const action = verdict && (verdict.action || verdict.verdict);
  const base = M.baseline(target);
  const rule = action === 'BET' && Number.isFinite(Number(n.test_rate)) && n.test_rate != null;
  return { chance: rule ? M.round(Number(n.test_rate)) : base, source: rule ? 'rule' : 'baseline', baseline: base,
    break_even: M.round(1 / Number(target)),
    label: rule ? 'Estimate: the chosen rule’s hit rate on rounds it had not seen. Not a guarantee.'
      : 'Estimate: JetX’s published odds (0.97 / target). No rule has a proven edge. Not a guarantee.' };
}

module.exports = { estimate, GAME, DEMO_START, SETTLE_MS, CONTROLS, SOURCES, MODES, REASONS, MIN_AUTO_NOTE, NOTICE,
  decide, cleanManual, settleWith, roundFor, summarize, refOf };
