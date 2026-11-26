// Crash Predictor persistence (migrations 0028 and 0029). Every statement is scoped to the owner (WHERE user_id = ?),
// so one user never reads or changes another user's settings, rounds, bets or audit. sqlStore() talks to MySQL;
// memoryStore() is the same interface in memory, for tests. Times are UTC Date objects.
const db = require('../../db');

const ROUND_COLS = 'id, game, round_id, multiplier, observed_at, source';
const BET_COLS = 'id, session_id, round_id, game, source, stake, target, cashout, outcome, payout, multiplier, demo, '
  + 'client_ref, placed_at, settled_at';
const SETTLED = "outcome IN ('won','lost')";

function sqlStore(q = db) {
  return {
    getSettings: (userId) => q.one('SELECT * FROM crash_settings WHERE user_id = ?', [userId]),
    async saveSettings(userId, s, { realMoneyAck = false } = {}) {
      const vals = [s.target_cashout, s.stake, s.currency, s.demo_mode ? 1 : 0, s.stake_cap, s.stop_loss,
        s.daily_loss_limit, s.max_bets_per_session, s.kill_switch ? 1 : 0, s.site_url];
      const ack = realMoneyAck ? 'UTC_TIMESTAMP(3)' : 'NULL';
      await q.query(`INSERT INTO crash_settings (user_id, target_cashout, stake, currency, demo_mode, stake_cap,
        stop_loss, daily_loss_limit, max_bets_per_session, kill_switch, site_url, real_money_ack_at, created_at,
        updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, ${ack}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE target_cashout = VALUES(target_cashout), stake = VALUES(stake),
        currency = VALUES(currency), demo_mode = VALUES(demo_mode), stake_cap = VALUES(stake_cap),
        stop_loss = VALUES(stop_loss), daily_loss_limit = VALUES(daily_loss_limit),
        max_bets_per_session = VALUES(max_bets_per_session), kill_switch = VALUES(kill_switch),
        site_url = VALUES(site_url), real_money_ack_at = COALESCE(VALUES(real_money_ack_at), real_money_ack_at),
        updated_at = UTC_TIMESTAMP(3)`, [userId, ...vals]);
    },
    audit: (userId, event, details, ip = '') => q.query(`INSERT INTO crash_audit (user_id, event, details, ip,
      created_at) VALUES (?,?,?,?, UTC_TIMESTAMP(3))`, [userId, event, details ? JSON.stringify(details) : null,
      String(ip || '').slice(0, 64)]),
    async roundStats(userId, game, since, target) {
      const r = await q.one(`SELECT COUNT(*) AS n, COALESCE(SUM(multiplier >= ?), 0) AS hits,
        COALESCE(SUM(source = 'collector'), 0) AS collected FROM crash_rounds
        WHERE user_id = ? AND game = ? AND observed_at >= ?`, [target, userId, game, since]);
      return { n: Number(r && r.n) || 0, hits: Number(r && r.hits) || 0, collected: Number(r && r.collected) || 0 };
    },
    // since: bets placed from then; sessionId: only that session's bets; demo (v0.37.0): true / false for demo or
    // real-money bets only (any may be null).
    async betStats(userId, game, { since = null, sessionId = null, demo = null } = {}) {
      const where = (since ? ' AND placed_at >= ?' : '') + (sessionId ? ' AND session_id = ?' : '')
        + (demo == null ? '' : ` AND demo = ${demo ? 1 : 0}`);
      const r = await q.one(`SELECT COUNT(*) AS n, COALESCE(SUM(outcome = 'won'), 0) AS wins,
        COALESCE(SUM(outcome = 'lost'), 0) AS losses, COALESCE(SUM(stake), 0) AS staked,
        COALESCE(SUM(CASE WHEN ${SETTLED} THEN payout - stake ELSE 0 END), 0) AS profit
        FROM crash_bets WHERE user_id = ? AND game = ?${where}`,
      [userId, game, ...(since ? [since] : []), ...(sessionId ? [sessionId] : [])]);
      return { n: Number(r.n) || 0, wins: Number(r.wins) || 0, losses: Number(r.losses) || 0,
        staked: Number(r.staked) || 0, profit: Number(r.profit) || 0 };
    },
    openSession: (userId, game) => q.one(`SELECT id, game, demo, started_at FROM crash_sessions
      WHERE user_id = ? AND game = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [userId, game]),
    listRounds: (userId, game, limit) => q.query(`SELECT ${ROUND_COLS} FROM crash_rounds WHERE user_id = ? AND game = ?
      ORDER BY observed_at DESC, id DESC LIMIT ?`, [userId, game, limit]),
    listBets: (userId, game, limit) => q.query(`SELECT ${BET_COLS} FROM crash_bets WHERE user_id = ? AND game = ?
      ORDER BY placed_at DESC, id DESC LIMIT ?`, [userId, game, limit]),
    // Step 3 (v0.35.0): the collector, CSV import and manual entry. INSERT IGNORE skips a round already stored
    // (unique user + game + round_id); the count inserted is affectedRows.
    async insertRounds(userId, game, rounds) {
      let inserted = 0;
      for (let i = 0; i < rounds.length; i += 500) {
        const part = rounds.slice(i, i + 500);
        const res = await q.query(`INSERT IGNORE INTO crash_rounds (user_id, game, round_id, multiplier, observed_at,
          source, created_at) VALUES ${part.map(() => '(?,?,?,?,?,?, UTC_TIMESTAMP(3))').join(',')}`,
        part.flatMap((r) => [userId, game, r.round_id, r.multiplier, r.observed_at, r.source]));
        inserted += Number(res && res.affectedRows) || 0;
      }
      return inserted;
    },
    roundsNear: (userId, game, from, to) => q.query(`SELECT ${ROUND_COLS} FROM crash_rounds WHERE user_id = ?
      AND game = ? AND observed_at BETWEEN ? AND ? ORDER BY observed_at DESC LIMIT 500`, [userId, game, from, to]),
    lastRound: (userId, game, source) => q.one(`SELECT ${ROUND_COLS} FROM crash_rounds WHERE user_id = ? AND game = ?
      AND source = ? ORDER BY observed_at DESC, id DESC LIMIT 1`, [userId, game, source]),
    async startSession(userId, game, demo) {
      const res = await q.query(`INSERT INTO crash_sessions (user_id, game, demo, started_at)
        VALUES (?,?,?, UTC_TIMESTAMP(3))`, [userId, game, demo ? 1 : 0]);
      return q.one('SELECT id, game, demo, started_at FROM crash_sessions WHERE id = ? AND user_id = ?',
        [res.insertId, userId]);
    },
    endSession: (userId, game, id, reason) => q.query(`UPDATE crash_sessions SET ended_at = UTC_TIMESTAMP(3),
      end_reason = ? WHERE id = ? AND user_id = ? AND game = ? AND ended_at IS NULL`,
    [String(reason).slice(0, 40), id, userId, game]),
    // Step 4 (v0.36.0): the analysis engine reads the newest `limit` multipliers; roundsMeta keys its cache.
    recentMultipliers: (userId, game, limit) => q.query(`SELECT id, multiplier FROM crash_rounds WHERE user_id = ?
      AND game = ? ORDER BY observed_at DESC, id DESC LIMIT ?`, [userId, game, limit]),
    async roundsMeta(userId, game) {
      const r = await q.one(`SELECT COUNT(*) AS n, MAX(id) AS max_id FROM crash_rounds WHERE user_id = ? AND game = ?`,
        [userId, game]);
      return { n: Number(r && r.n) || 0, max_id: r && r.max_id != null ? String(r.max_id) : null };
    },
    // Step 5 (v0.37.0): auto-bet and manual bets. A bet is settled once (WHERE outcome = 'pending').
    async insertBet(userId, game, b) {
      const res = await q.query(`INSERT INTO crash_bets (user_id, session_id, round_id, game, source, stake, target,
        cashout, outcome, payout, multiplier, demo, client_ref, placed_at, settled_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, ${b.outcome === 'pending' ? 'NULL' : 'UTC_TIMESTAMP(3)'})`,
      [userId, b.session_id || null, b.round_id || null, game, b.source, b.stake, b.target, b.cashout ?? null,
        b.outcome, b.payout, b.multiplier ?? null, b.demo ? 1 : 0, b.client_ref || null, b.placed_at]);
      return q.one(`SELECT ${BET_COLS} FROM crash_bets WHERE id = ? AND user_id = ?`, [res.insertId, userId]);
    },
    getBet: (userId, game, id) => q.one(`SELECT ${BET_COLS} FROM crash_bets WHERE id = ? AND user_id = ?
      AND game = ?`, [id, userId, game]),
    betByRef: (userId, game, ref) => q.one(`SELECT ${BET_COLS} FROM crash_bets WHERE user_id = ? AND game = ?
      AND client_ref = ?`, [userId, game, ref]),
    pendingBets: (userId, game, limit) => q.query(`SELECT ${BET_COLS} FROM crash_bets WHERE user_id = ? AND game = ?
      AND outcome = 'pending' ORDER BY placed_at, id LIMIT ?`, [userId, game, limit]),
    async settleBet(userId, game, id, v) {
      const res = await q.query(`UPDATE crash_bets SET outcome = ?, payout = ?, multiplier = ?, cashout = ?,
        round_id = COALESCE(?, round_id), settled_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ? AND game = ?
        AND outcome = 'pending'`, [v.outcome, v.payout, v.multiplier ?? null, v.cashout ?? null, v.round_id || null,
        id, userId, game]);
      return Number(res && res.affectedRows) || 0;
    },
  };
}

function memoryStore(seed = {}) {
  const s = { settings: new Map(), audit: [], rounds: seed.rounds || [], bets: seed.bets || [],
    sessions: seed.sessions || [], seq: 1000 };
  const mine = (rows, userId, game) => rows.filter((r) => r.user_id === userId && (r.game || 'jetx') === game);
  const newest = (k) => (a, b) => new Date(b[k]) - new Date(a[k]) || b.id - a.id;
  return {
    _s: s,
    async getSettings(userId) { return s.settings.get(userId) || null; },
    async saveSettings(userId, v, { realMoneyAck = false } = {}) {
      const was = s.settings.get(userId) || {};
      s.settings.set(userId, { ...v, user_id: userId,
        real_money_ack_at: realMoneyAck ? new Date() : was.real_money_ack_at || null });
    },
    async audit(userId, event, details, ip = '') { s.audit.push({ user_id: userId, event, details, ip }); },
    async roundStats(userId, game, since, target) {
      const rows = mine(s.rounds, userId, game).filter((r) => new Date(r.observed_at) >= since);
      return { n: rows.length, hits: rows.filter((r) => Number(r.multiplier) >= target).length,
        collected: rows.filter((r) => r.source === 'collector').length };
    },
    async betStats(userId, game, { since = null, sessionId = null, demo = null } = {}) {
      const rows = mine(s.bets, userId, game).filter((b) => (!since || new Date(b.placed_at) >= since)
        && (!sessionId || b.session_id === sessionId) && (demo == null || Boolean(Number(b.demo)) === demo));
      const settled = rows.filter((b) => b.outcome === 'won' || b.outcome === 'lost');
      const sum = (xs, f) => xs.reduce((t, b) => t + f(b), 0);
      return { n: rows.length, wins: rows.filter((b) => b.outcome === 'won').length,
        losses: rows.filter((b) => b.outcome === 'lost').length, staked: sum(rows, (b) => Number(b.stake)),
        profit: Math.round(sum(settled, (b) => Number(b.payout) - Number(b.stake)) * 100) / 100 };
    },
    async openSession(userId, game) {
      return mine(s.sessions, userId, game).filter((x) => !x.ended_at).sort(newest('started_at'))[0] || null;
    },
    async listRounds(userId, game, limit) {
      return mine(s.rounds, userId, game).sort(newest('observed_at')).slice(0, limit);
    },
    async listBets(userId, game, limit) {
      return mine(s.bets, userId, game).sort(newest('placed_at')).slice(0, limit);
    },
    async insertRounds(userId, game, rounds) {
      let inserted = 0;
      for (const r of rounds) {
        if (mine(s.rounds, userId, game).some((x) => x.round_id === r.round_id)) continue;
        s.rounds.push({ ...r, id: ++s.seq, user_id: userId, game });
        inserted += 1;
      }
      return inserted;
    },
    async roundsNear(userId, game, from, to) {
      return mine(s.rounds, userId, game).filter((r) => new Date(r.observed_at) >= from
        && new Date(r.observed_at) <= to);
    },
    async lastRound(userId, game, source) {
      return mine(s.rounds, userId, game).filter((r) => r.source === source).sort(newest('observed_at'))[0] || null;
    },
    async startSession(userId, game, demo) {
      const row = { id: ++s.seq, user_id: userId, game, demo: demo ? 1 : 0, started_at: new Date(), ended_at: null };
      s.sessions.push(row);
      return row;
    },
    async endSession(userId, game, id, reason) {
      const row = mine(s.sessions, userId, game).find((x) => x.id === id && !x.ended_at);
      if (row) Object.assign(row, { ended_at: new Date(), end_reason: reason });
    },
    async recentMultipliers(userId, game, limit) {
      return mine(s.rounds, userId, game).sort(newest('observed_at')).slice(0, limit)
        .map((r) => ({ id: r.id, multiplier: r.multiplier }));
    },
    async roundsMeta(userId, game) {
      const rows = mine(s.rounds, userId, game);
      const max = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      return { n: rows.length, max_id: rows.length ? String(max) : null };
    },
    async insertBet(userId, game, b) {
      const id = ++s.seq;
      s.bets.push({ id, user_id: userId, game, session_id: b.session_id || null, round_id: b.round_id || null,
        source: b.source, stake: b.stake, target: b.target, cashout: b.cashout ?? null, outcome: b.outcome,
        payout: b.payout, multiplier: b.multiplier ?? null, demo: b.demo ? 1 : 0, client_ref: b.client_ref || null,
        placed_at: b.placed_at, settled_at: b.outcome === 'pending' ? null : new Date() });
      return s.bets[s.bets.length - 1];
    },
    async getBet(userId, game, id) {
      return mine(s.bets, userId, game).find((b) => String(b.id) === String(id)) || null;
    },
    async betByRef(userId, game, ref) {
      return mine(s.bets, userId, game).find((b) => b.client_ref && b.client_ref === ref) || null;
    },
    async pendingBets(userId, game, limit) {
      return mine(s.bets, userId, game).filter((b) => b.outcome === 'pending')
        .sort((a, b) => new Date(a.placed_at) - new Date(b.placed_at) || a.id - b.id).slice(0, limit);
    },
    async settleBet(userId, game, id, v) {
      const row = mine(s.bets, userId, game).find((b) => String(b.id) === String(id) && b.outcome === 'pending');
      if (!row) return 0;
      Object.assign(row, { outcome: v.outcome, payout: v.payout, multiplier: v.multiplier ?? null,
        cashout: v.cashout ?? null, round_id: v.round_id || row.round_id || null, settled_at: new Date() });
      return 1;
    },
  };
}

module.exports = { sqlStore, memoryStore };
