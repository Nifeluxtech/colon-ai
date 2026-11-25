// Crash Predictor (v0.33.0, step 1 of docs/crash-predictor/HANDOFF.md): a JetX companion for signed-in Colon users.
// Step 1 holds the account's settings (target cash-out, stake, demo mode, guardrails, betting site), the dashboard
// summary and the round and bet lists. Rounds arrive from the collector in step 3; the analysis engine (step 4)
// does not exist yet, so the verdict is always WAIT (or STOP when a guardrail has tripped). Never a prediction.
// Step 3 (v0.35.0) stores rounds from the Colon JetX collector, CSV imports and manual entries (collect.js,
// rounds.js) and opens the collector's session; the dashboard shows the collector's status.
//   create({ store }) -> { getSettings, updateSettings, dashboard, rounds, bets, addRounds, importCsv,
//   startSession, stopSession }; other layers import only this file.
const { sqlStore, memoryStore } = require('./store');
const S = require('./settings');
const M = require('./math');
const R = require('./rounds');
const { collector } = require('./collect');

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
const betOut = (b) => ({ id: String(b.id), session_id: b.session_id ? String(b.session_id) : null,
  round_id: b.round_id ? String(b.round_id) : null, stake: Number(b.stake), target: Number(b.target),
  outcome: b.outcome, payout: Number(b.payout), demo: Boolean(Number(b.demo)), placed_at: iso(b.placed_at),
  settled_at: iso(b.settled_at) });

function verdictFor(rails) {
  if (rails.status !== 'ok') return { action: 'STOP', reason: rails.reasons[0].message, engine: false };
  return { action: 'WAIT', engine: false, reason: 'The analysis engine isn’t built yet, so there is no proven edge '
    + 'over the baseline. Colon waits until a model beats it on rounds it has not seen.' };
}

function create({ store = sqlStore(), clock = () => new Date() } = {}) {
  const uid = (u) => { if (!u || !u.id) throw err(401, 'unauthenticated', 'Please sign in.'); return u.id; };
  const col = collector({ store, clock, settingsOf: async (id) => S.fromRow(await store.getSettings(id)) });

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
    const [rs, today, session] = await Promise.all([store.roundStats(id, GAME, since, target),
      store.betStats(id, GAME, { since }), store.openSession(id, GAME)]);
    const sess = session ? await store.betStats(id, GAME, { sessionId: session.id }) : { n: 0, profit: 0 };
    const rails = S.guardrails(settings, { sessionBets: sess.n, sessionProfit: sess.profit,
      todayProfit: today.profit });
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
      verdict: verdictFor(rails),
      recent_rounds: recentRounds.map(roundOut),
      recent_bets: recentBets.map(betOut),
    };
  }

  const rounds = async (u, { limit } = {}) => (await store.listRounds(uid(u), GAME, limitOf(limit, 50))).map(roundOut);
  const bets = async (u, { limit } = {}) => (await store.listBets(uid(u), GAME, limitOf(limit, 50))).map(betOut);

  const addRounds = async (u, body, o) => col.addRounds(uid(u), body, o);
  const importCsv = async (u, body, o) => col.importCsv(uid(u), body, o);
  const startSession = async (u, o) => col.startSession(uid(u), o);
  const stopSession = async (u, o) => col.stopSession(uid(u), o);

  return { getSettings, updateSettings, dashboard, rounds, bets, addRounds, importCsv, startSession, stopSession,
    store };
}

let shared = null;
const instance = () => (shared || (shared = create()));

const handlers = {
  // GET /crash/dashboard?tz_offset= -> the dashboard summary
  getDashboard: async (req) => [200, await instance().dashboard(req.user, { tzOffset: req.query.get('tz_offset') })],
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
};

module.exports = { create, instance, memoryStore, handlers, dayStart, verdictFor, GAME,
  math: M, settings: S, rounds: R };
