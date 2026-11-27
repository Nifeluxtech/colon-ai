// Crash Predictor step 5 (v0.38.0): auto-bet decisions, bet records and settlement (docs/crash-predictor/HANDOFF.md).
//   autobet({ store, clock, settingsOf, verdictOf }) -> { decide, record, settle, settlePending, state }
// Colon JetX asks decide() before each round. It allows a bet only when the verdict is BET and every guardrail is
// clear (autobet-rules.js); an allowed decision records the bet at once (pending), so the guardrails count it even
// if the app never reports back. Demo bets are never clicked: they are settled against the next collected round.
// A real-money bet is clicked by the app only when the account is out of demo mode AND the app's own real-money
// switch is on; if its click fails it reports the bet void. The user's own bets are recorded as source 'manual'
// (read-only, never gated). Every decision and every bet is written to crash_audit.
const A = require('./autobet-rules');
const S = require('./settings');
const G = require('./guess');

const GAME = A.GAME;
const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });
const iso = (t) => (t ? new Date(t).toISOString() : null);
const nOrNull = (x) => (x == null ? null : Number(x));

const betOut = (b) => ({ id: String(b.id), session_id: b.session_id ? String(b.session_id) : null,
  round_id: b.round_id ? String(b.round_id) : null, source: b.source || 'auto', stake: Number(b.stake),
  target: nOrNull(b.target), cashout: nOrNull(b.cashout), outcome: b.outcome, payout: Number(b.payout),
  multiplier: nOrNull(b.multiplier), demo: Boolean(Number(b.demo)), mode: Number(b.demo) ? 'demo' : 'real',
  client_ref: b.client_ref || null, placed_at: iso(b.placed_at), settled_at: iso(b.settled_at) });

// railsFor(userId, settings, { since, demo }) -> { rails, session }: the guardrails over bets of that mode only.
function autobet({ store, clock = () => new Date(), settingsOf, railsFor, verdictOf, guessOf }) {
  // Settles pending bets: by the first round collected after each was placed, or void after SETTLE_MS.
  async function settlePending(userId) {
    const now = clock();
    const pending = await store.pendingBets(userId, GAME, 100);
    let settled = 0;
    for (const b of pending) {
      const placed = new Date(b.placed_at).getTime();
      let v = null;
      if (b.target != null) {
        const until = new Date(Math.min(placed + A.SETTLE_MS, now.getTime()));
        const near = until.getTime() > placed ? await store.roundsNear(userId, GAME, new Date(placed + 1), until) : [];
        const r = A.roundFor(b, near);
        if (r) v = { ...A.settleWith(b, { multiplier: Number(r.multiplier) }), round_id: r.id };
      }
      if (!v && now.getTime() - placed > A.SETTLE_MS) v = A.settleWith(b, { outcome: 'void' });
      if (!v) continue;
      if (await store.settleBet(userId, GAME, b.id, v)) {
        settled += 1;
        await store.audit(userId, 'bet.settled', { bet: String(b.id), outcome: v.outcome, payout: v.payout,
          multiplier: v.multiplier, by: v.round_id ? 'round' : 'timeout' });
      }
    }
    return settled;
  }

  async function sessionFor(userId, demo) {
    return (await store.openSession(userId, GAME)) || store.startSession(userId, GAME, demo);
  }

  // body: { control: 'ai' | 'shared', real?: bool, dry_run?: bool, client_ref?, tz_offset? } -> the decision, and
  // the recorded bet when it is allowed and not a dry run (Shared mode asks with dry_run, then again on confirm).
  async function decide(userId, body, { ip = '', since } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const ref = A.refOf(b.client_ref);
    if (ref) {
      const had = await store.betByRef(userId, GAME, ref);
      if (had) return { allow: true, code: 'duplicate', duplicate: true, bet: betOut(had), stake: Number(had.stake),
        target: nOrNull(had.target), demo: Boolean(Number(had.demo)), mode: Number(had.demo) ? 'demo' : 'real',
        reason: 'This bet was already recorded.' };
    }
    await settlePending(userId);
    const settings = await settingsOf(userId);
    const demo = !(b.real === true && settings.demo_mode === false);
    const { rails } = await railsFor(userId, settings, { since, demo });
    const verdict = await verdictOf(userId, settings, rails);
    const open = (await store.pendingBets(userId, GAME, 20)).filter((x) => x.source !== 'manual');
    const d = A.decide({ settings, rails, verdict, control: String(b.control || ''), real: b.real === true,
      pending: open.length > 0 });
    const dry = b.dry_run === true;
    await store.audit(userId, 'autobet.decision', { allow: d.allow, code: d.code, control: b.control || null,
      mode: d.mode, stake: d.stake, target: d.target, verdict: verdict.action, dry_run: dry }, ip);
    const out = { ...d, dry_run: dry, verdict: { action: verdict.action, reason: verdict.reason }, guardrails: rails,
      bet: null };
    if (!d.allow || dry) return out;
    const session = await sessionFor(userId, d.demo);
    const row = await store.insertBet(userId, GAME, { session_id: session ? session.id : null, source: 'auto',
      stake: d.stake, target: d.target, outcome: 'pending', payout: 0, demo: d.demo, client_ref: ref,
      placed_at: clock() });
    await store.audit(userId, 'bet.placed', { bet: String(row.id), source: 'auto', mode: d.mode, stake: d.stake,
      target: d.target, control: b.control }, ip);
    return { ...out, bet: betOut(row) };
  }

  // POST /crash/bets. source 'auto' goes through decide() (409 when refused); 'manual' is the user's own bet.
  async function record(userId, body, { ip = '', since } = {}) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const source = b.source == null ? 'manual' : String(b.source);
    if (!A.SOURCES.includes(source)) throw err(422, 'invalid', 'Source must be auto or manual.', 'source');
    if (source === 'auto') {
      const d = await decide(userId, { ...b, real: b.mode === 'real', dry_run: false }, { ip, since });
      if (!d.allow) throw Object.assign(err(409, d.code, d.reason), { extra: { decision: d } });
      return { bet: d.bet, duplicate: Boolean(d.duplicate), decision: d };
    }
    const bet = A.cleanManual(b, clock());
    if (bet.client_ref) {
      const had = await store.betByRef(userId, GAME, bet.client_ref);
      if (had) return { bet: betOut(had), duplicate: true };
    }
    const session = await store.openSession(userId, GAME);
    const row = await store.insertBet(userId, GAME, { ...bet, session_id: session ? session.id : null });
    await store.audit(userId, 'bet.manual', { bet: String(row.id), mode: bet.demo ? 'demo' : 'real',
      stake: bet.stake, target: bet.target, outcome: bet.outcome }, ip);
    return { bet: betOut(row), duplicate: false };
  }

  // POST /crash/bets/:id/settle { multiplier?, cashout?, outcome? }. A demo auto bet is settled by its round only,
  // so the app may void it (a cancelled bet) but not say how it went.
  async function settle(userId, id, body, { ip = '' } = {}) {
    if (!/^\d{1,20}$/.test(String(id))) throw err(404, 'not_found', 'No such bet.');
    const bet = await store.getBet(userId, GAME, id);
    if (!bet) throw err(404, 'not_found', 'No such bet.');
    if (bet.outcome !== 'pending') throw err(409, 'settled', 'This bet is already settled.');
    const b = body && typeof body === 'object' ? body : {};
    if (bet.source !== 'manual' && Number(bet.demo) && b.outcome !== 'void') {
      throw err(409, 'demo_settles_itself', 'Demo bets are settled against the next collected round.');
    }
    const v = A.settleWith(bet, { multiplier: b.multiplier, cashout: b.cashout, outcome: b.outcome });
    if (!v) throw err(422, 'invalid', 'Send the cash-out, the round’s multiplier, lost or void.');
    const reason = b.reason == null ? null : String(b.reason).replace(/[^a-z0-9_]/gi, '').slice(0, 40);
    await store.settleBet(userId, GAME, bet.id, v);
    await store.audit(userId, 'bet.settled', { bet: String(bet.id), outcome: v.outcome, payout: v.payout,
      multiplier: v.multiplier, cashout: v.cashout, by: 'app', reason }, ip);
    return { bet: betOut(await store.getBet(userId, GAME, bet.id)) };
  }

  // GET /crash/autobet -> mode, demo balance, both modes' guardrails, the verdict, what a decision would say now,
  // the bet log (auto and manual) and its hit rate against the baseline and break-even.
  async function state(userId, { since } = {}) {
    await settlePending(userId);
    const settings = await settingsOf(userId);
    const demo = settings.demo_mode !== false;
    const [d, r, demoAll, list] = await Promise.all([railsFor(userId, settings, { since, demo: true }),
      railsFor(userId, settings, { since, demo: false }), store.betStats(userId, GAME, { demo: true }),
      store.listBets(userId, GAME, 200)]);
    const rails = demo ? d.rails : r.rails;
    const verdict = await verdictOf(userId, settings, rails);
    const open = list.filter((x) => x.outcome === 'pending' && x.source !== 'manual');
    const preview = A.decide({ settings, rails, verdict, control: 'ai', real: !demo, pending: open.length > 0 });
    const t = settings.target_cashout;
    return { game: GAME, mode: demo ? 'demo' : 'real', settings,
      demo_balance: { start: A.DEMO_START, balance: Math.round((A.DEMO_START + demoAll.profit) * 100) / 100,
        profit: demoAll.profit, currency: settings.currency },
      guardrails: { demo: d.rails, real: r.rails }, verdict, decision_now: preview,
      honest: { target: t, baseline: Math.round(Math.min(1, 0.97 / t) * 1e4) / 1e4,
        break_even: Math.round((1 / t) * 1e4) / 1e4, min_auto_note: A.MIN_AUTO_NOTE },
      stats: A.summarize(list), bets: list.slice(0, 50).map(betOut), warning: S.REAL_MONEY_WARNING,
      notice: A.NOTICE };
  }

  // GET /crash/live -> the compact view for the side panel and the full-screen bubble: target, the estimated chance
  // for the next round (labelled an estimate), the verdict, the newest recorded multipliers and the kill switch.
  async function live(userId, { since, limit = 20 } = {}) {
    const settings = await settingsOf(userId);
    const { rails } = await railsFor(userId, settings, { since, demo: settings.demo_mode !== false });
    const [verdict, rounds, last] = await Promise.all([verdictOf(userId, settings, rails),
      store.listRounds(userId, GAME, Math.max(1, Math.min(50, Number(limit) || 20))),
      store.recentMultipliers(userId, GAME, G.ALL_ROUNDS)]);
    return { game: GAME, target: settings.target_cashout, estimate: A.estimate(verdict, settings.target_cashout),
      verdict: { action: verdict.action, reason: verdict.reason, strategy: verdict.strategy || null },
      recent: rounds.map((r) => ({ id: String(r.id), multiplier: Number(r.multiplier), observed_at: iso(r.observed_at),
        hit: Number(r.multiplier) >= settings.target_cashout })),
      kill_switch: settings.kill_switch, demo_mode: settings.demo_mode !== false, notice: A.NOTICE,
      // 0.39.3: the guess (guess.js) and its AI read (ai-read.js), made after the verdict; nothing reads them back.
      guess: guessOf ? await guessOf(userId, last, verdict)
        : G.guess(last.map((r) => Number(r.multiplier)).reverse()) };
  }

  return { decide, record, settle, settlePending, state, live };
}

module.exports = { autobet, betOut };
