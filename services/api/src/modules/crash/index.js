// Crash Predictor (v0.33.0, step 1 of docs/crash-predictor/HANDOFF.md): a JetX companion for signed-in Colon users.
// Step 1 holds the account's settings (target cash-out, stake, demo mode, guardrails, betting site), the dashboard
// summary and the round and bet lists. Rounds arrive from the collector in step 3; the analysis engine (step 4)
// does not exist yet, so the verdict is always WAIT (or STOP when a guardrail has tripped). Never a prediction.
// Step 3 (v0.35.0) stores rounds from the Colon JetX collector, CSV imports and manual entries (collect.js,
// rounds.js) and opens the collector's session; the dashboard shows the collector's status.
// Step 4 (v0.36.0): the analysis engine (engine.js, stats.js, strategies.js, dist.js, analysis.js) gives the real
// verdict (BET / WAIT / STOP with its reason and numbers) and GET /crash/analysis returns the full analysis.
// Step 5 (v0.38.0): auto-bet (autobet.js, autobet-rules.js): GET|POST /crash/autobet (state; the decision before
// each round, BET verdict + guardrails), POST /crash/autobet/stop (kill switch), POST /crash/bets (auto through the
// decision; the user's own bets as source manual), POST /crash/bets/:id/settle. Guardrails count one mode's bets.
//   create({ store }) -> { getSettings, updateSettings, dashboard, analysis, rounds, bets, addRounds, importCsv,
//   startSession, stopSession, autobetState, decide, recordBet, settleBet, stopAll, live }; other layers import only
//   this file. GET /crash/live is the side panel's and the full-screen bubble's compact view.
const { sqlStore, memoryStore } = require('./store');
const S = require('./settings');
const M = require('./math');
const R = require('./rounds');
const { collector } = require('./collect');
const E = require('./engine');
const { analyzer, MAX_ROUNDS } = require('./analysis');
const { autobet, betOut } = require('./autobet');
const AR = require('./autobet-rules');
const CO = require('./cashout');

const GAME = 'jetx';
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

// The start of the user's day. tzOffset is the browser's getTimezoneOffset() in minutes (Lagos: -60).
function dayStart(now = new Date(), tzOffset = 0) {
  const off = Math.max(-840, Math.min(840, Math.round(Number(tzOffset) || 0))) * 60000;
  const local = new Date(now.getTime() - off);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + off);
}
const limitOf = (v, d = 20) => Math.max(1, Math.min(100, Math.round(Number(v) || d)));
const iso = (t) => (t ? new Date(t).toISOString() : null);
const money = (x) => Math.round(Number(x || 0) * 100) / 100;

const roundOut = (r) => ({ id: String(r.id), round_id: r.round_id, multiplier: Number(r.multiplier),
  observed_at: iso(r.observed_at), source: r.source });

// -> { action, verdict, reason, strategy, numbers, engine, note }: STOP on a guardrail, else the engine's call.
const verdictFor = (rails, analysis = null) => E.verdict(analysis, rails);

// CRASH_CASHOUT_MIN_CHANCE (0.39.4): the estimated chance the cash-out line needs (default 0.75).
function cashoutConfig() {
  try { return { minChance: require('../../config').crash.cashoutMinChance }; } catch { return {}; }
}

// verdictOf (tests only): (userId, settings, rails) -> a verdict, in place of the analysis engine's.
// cashoutCfg (0.39.4): () -> { minChance } for the cash-out line (tests pass their own).
function create({ store = sqlStore(), clock = () => new Date(), verdictOf = null, cashoutCfg = cashoutConfig } = {}) {
  const uid = (u) => { if (!u || !u.id) throw err(401, 'unauthenticated', 'Please sign in.'); return u.id; };
  const col = collector({ store, clock, settingsOf: async (id) => S.fromRow(await store.getSettings(id)) });
  const engine = analyzer({ store, clock });
  const settingsOf = async (id) => S.fromRow(await store.getSettings(id));
  // "Cash out at 1.20x · 75%+": the engine's estimate for each candidate multiplier (cashout.js), display only,
  // never read by a decision. The same newest rounds the engine analyses.
  const cashoutRun = CO.cashoutCache();
  const cashoutOf = async (id) => cashoutRun(id, await store.roundsMeta(id, GAME),
    async () => (await store.recentMultipliers(id, GAME, MAX_ROUNDS)).map((r) => Number(r.multiplier)).reverse(),
    cashoutCfg() || {});
  const auto = autobet({ store, clock, settingsOf, cashoutOf,
    railsFor: async (id, settings, { since, demo }) => railsOf(id, settings, since || dayStart(clock()), demo),
    verdictOf: verdictOf || (async (id, settings, rails) => verdictFor(rails,
      await engine.run(id, GAME, settings.target_cashout))) });

  // Today's and this session's bets against the user's guardrails. v0.38.0: only bets of one mode count (demo
  // bets never use up the real-money limits, nor real bets the demo ones); by default the account's mode.
  async function railsOf(id, settings, since, demo = settings.demo_mode !== false) {
    const [today, session] = await Promise.all([store.betStats(id, GAME, { since, demo }),
      store.openSession(id, GAME)]);
    const sess = session ? await store.betStats(id, GAME, { sessionId: session.id, demo }) : { n: 0, profit: 0 };
    const rails = S.guardrails(settings, { sessionBets: sess.n, sessionProfit: sess.profit,
      todayProfit: today.profit });
    return { today, session, sess, rails };
  }

  async function getSettings(u) { return S.fromRow(await store.getSettings(uid(u))); }

  // -> { settings, changes }. Every change is written to crash_audit; switching to real money is its own event.
  async function updateSettings(u, patch, { ip = '' } = {}) {
    const id = uid(u);
    const current = S.fromRow(await store.getSettings(id));
    const { settings, changes } = S.validate(patch, current);
    const keys = Object.keys(changes);
    if (!keys.length) return { settings, changes };
    const realMoney = changes.demo_mode && settings.demo_mode === false;
    await store.saveSettings(id, settings, { realMoneyAck: Boolean(realMoney) });
    await store.audit(id, 'settings.updated', { changes }, ip);
    if (realMoney) await store.audit(id, 'demo_mode.off', { warning_acknowledged: true }, ip);
    if (changes.demo_mode && settings.demo_mode) await store.audit(id, 'demo_mode.on', null, ip);
    if (changes.kill_switch) {
      await store.audit(id, settings.kill_switch ? 'kill_switch.on' : 'kill_switch.off', null, ip);
    }
    return { settings, changes };
  }

  async function dashboard(u, { tzOffset = 0 } = {}) {
    const id = uid(u);
    const settings = S.fromRow(await store.getSettings(id));
    const target = settings.target_cashout;
    const since = dayStart(clock(), tzOffset);
    const [rs, { today, session, sess, rails }, an] = await Promise.all([store.roundStats(id, GAME, since, target),
      railsOf(id, settings, since), engine.run(id, GAME, target)]);
    const [recentRounds, recentBets, coll] = await Promise.all([store.listRounds(id, GAME, 10),
      store.listBets(id, GAME, 10), col.status(id, { collectedToday: rs.collected || 0, session })]);
    return {
      game: GAME,
      account: { name: u.name || '', email: u.email || '', email_verified: Boolean(u.email_verified),
        totp_enabled: Boolean(u.totp_enabled) },
      settings,
      baseline: { target, probability: M.baseline(target), rtp: M.RTP, expected_return: M.expectedReturn(target),
        note: 'About 97% RTP: a round reaches the target with this chance whatever came before.' },
      today: { since: since.toISOString(), hit_rate: M.hitRate(rs.hits, rs.n, target), bets: today.n,
        wins: today.wins, losses: today.losses, staked: money(today.staked), profit: money(today.profit) },
      session: session ? { id: String(session.id), demo: Boolean(Number(session.demo)),
        started_at: iso(session.started_at), bets: sess.n, profit: money(sess.profit) } : null,
      collector: coll,
      guardrails: rails,
      verdict: verdictFor(rails, an),
      recent_rounds: recentRounds.map(roundOut),
      recent_bets: recentBets.map(betOut),
    };
  }

  // -> { limit, analysed, total_rounds, stats, strategies, verdict, guardrails, notice } over the newest rounds.
  async function analysis(u, { limit, tzOffset = 0 } = {}) {
    const id = uid(u);
    const settings = S.fromRow(await store.getSettings(id));
    const [{ rails }, an] = await Promise.all([railsOf(id, settings, dayStart(clock(), tzOffset)),
      engine.run(id, GAME, settings.target_cashout, { limit })]);
    const verdict = verdictFor(rails, an);
    return { game: GAME, target: settings.target_cashout, limit: an.limit, analysed: an.analysed,
      total_rounds: an.total_rounds, stats: an.stats, strategies: an.strategies, verdict,
      guardrails: rails, notice: E.NOTE, cashout: await cashoutOf(id) };
  }

  const rounds = async (u, { limit } = {}) => (await store.listRounds(uid(u), GAME, limitOf(limit, 50))).map(roundOut);
  const bets = async (u, { limit } = {}) => {
    await auto.settlePending(uid(u));
    return (await store.listBets(uid(u), GAME, limitOf(limit, 50))).map(betOut);
  };

  const addRounds = async (u, body, o) => col.addRounds(uid(u), body, o);
  const importCsv = async (u, body, o) => col.importCsv(uid(u), body, o);
  const startSession = async (u, o) => col.startSession(uid(u), o);
  const stopSession = async (u, o) => col.stopSession(uid(u), o);

  const since = (tzOffset) => dayStart(clock(), tzOffset);
  const autobetState = async (u, { tzOffset = 0 } = {}) => auto.state(uid(u), { since: since(tzOffset) });
  const decide = async (u, body, o = {}) => auto.decide(uid(u), body, { ...o, since: since(body && body.tz_offset) });
  const recordBet = async (u, body, o = {}) => auto.record(uid(u), body, { ...o,
    since: since(body && body.tz_offset) });
  const settleBet = async (u, id, body, o) => auto.settle(uid(u), id, body, o);
  const live = async (u, { tzOffset = 0, limit } = {}) => auto.live(uid(u), { since: since(tzOffset), limit });
  // The kill switch in one call (the app's STOP button): on at once, whatever else is in the settings.
  const stopAll = async (u, { ip = '' } = {}) => (await updateSettings(u, { kill_switch: true }, { ip })).settings;

  return { getSettings, updateSettings, dashboard, analysis, rounds, bets, addRounds, importCsv, startSession,
    stopSession, autobetState, decide, recordBet, settleBet, stopAll, live, store };
}

let shared = null;
const instance = () => (shared || (shared = create()));

const handlers = {
  // GET /crash/dashboard?tz_offset= -> the dashboard summary
  getDashboard: async (req) => [200, await instance().dashboard(req.user, { tzOffset: req.query.get('tz_offset') })],
  // GET /crash/analysis?limit=&tz_offset= -> stats, out-of-sample strategy tests and the verdict (newest 5000 rounds)
  getAnalysis: async (req) => [200, await instance().analysis(req.user, { limit: req.query.get('limit'),
    tzOffset: req.query.get('tz_offset') })],
  // GET /crash/settings -> { settings, limits, warning }
  getSettings: async (req) => [200, { settings: await instance().getSettings(req.user), limits: S.LIMITS,
    warning: S.REAL_MONEY_WARNING }],
  // PUT /crash/settings { ...fields, confirm_real_money? } -> { settings, changed[] }
  putSettings: async (req) => {
    const r = await instance().updateSettings(req.user, req.body, { ip: req.ip });
    return [200, { settings: r.settings, changed: Object.keys(r.changes) }];
  },
  // GET /crash/rounds?limit= and GET /crash/bets?limit= (newest first, at most 100)
  getRounds: async (req) => [200, { rounds: await instance().rounds(req.user, { limit: req.query.get('limit') }) }],
  getBets: async (req) => [200, { bets: await instance().bets(req.user, { limit: req.query.get('limit') }) }],
  // POST /crash/rounds { rounds: [{ multiplier, ended_at?, round_id? }], source } -> { inserted, duplicates,
  // rejected, errors[] } (source: collector | csv | manual; at most 100 rounds)
  postRounds: async (req) => [200, await instance().addRounds(req.user, req.body, { ip: req.ip })],
  // POST /crash/rounds/import { csv } -> the same counts plus rows (multiplier[,time][,round_id], 5000 rows at most)
  importRounds: async (req) => [200, await instance().importCsv(req.user, req.body, { ip: req.ip })],
  // POST /crash/sessions { action: 'start' | 'stop', reason? } -> { session, started | stopped }
  postSession: async (req) => {
    const b = req.body || {};
    if (b.action === 'start') return [200, await instance().startSession(req.user, { ip: req.ip })];
    if (b.action === 'stop') return [200, await instance().stopSession(req.user, { ip: req.ip, reason: b.reason })];
    throw err(422, 'invalid', 'Send action start or stop.');
  },
  // v0.38.0 (step 5). GET /crash/autobet?tz_offset= -> mode, demo balance, guardrails, verdict, bet log and hit rate
  getAutobet: async (req) => [200, await instance().autobetState(req.user, { tzOffset: req.query.get('tz_offset') })],
  // POST /crash/autobet { control: ai | shared, real?, dry_run?, client_ref?, tz_offset? } -> { allow, code, reason,
  // stake, target, demo, mode, verdict, guardrails, bet } (bet: recorded when allowed and not a dry run)
  postAutobet: async (req) => [200, await instance().decide(req.user, req.body, { ip: req.ip })],
  // GET /crash/live?limit=&tz_offset= -> { target, estimate, verdict, recent[], kill_switch, cashout (0.39.4) }
  getLive: async (req) => [200, await instance().live(req.user, { tzOffset: req.query.get('tz_offset'),
    limit: req.query.get('limit') })],
  // POST /crash/autobet/stop -> the kill switch on at once -> { settings }
  stopAutobet: async (req) => [200, { settings: await instance().stopAll(req.user, { ip: req.ip }) }],
  // POST /crash/bets { source: auto | manual, mode: demo | real, stake, target?, cashout?, multiplier?, outcome?,
  // placed_at?, client_ref? } -> { bet, duplicate }
  postBet: async (req) => [200, await instance().recordBet(req.user, req.body, { ip: req.ip })],
  // POST /crash/bets/:id/settle { multiplier? | cashout? | outcome: lost | void, reason? } -> { bet }
  settleBet: async (req) => [200, await instance().settleBet(req.user, req.params.id, req.body, { ip: req.ip })],
};

module.exports = { create, instance, memoryStore, handlers, dayStart, verdictFor, GAME,
  math: M, settings: S, rounds: R, engine: E, autobetRules: AR, cashout: CO };
