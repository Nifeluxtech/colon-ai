// Crash Predictor step 3 (v0.35.0): storing rounds from the Colon JetX collector, a CSV import or a manual entry,
// and the collector's session. Used by index.js (the module's public entry); see rounds.js for the cleaning rules.
//   collector({ store, clock, settingsOf }) -> { addRounds, importCsv, startSession, stopSession, status }
// addRounds and importCsv answer { inserted, duplicates, rejected, errors[] } (at most 20 errors, each
// { index | line, reason }). A round already stored (same round id) or seen twice by the collector counts as a
// duplicate; a bad one is rejected and the rest are still stored.
const R = require('./rounds');

const GAME = 'jetx';
const LIVE_MS = 2 * 60 * 1000;
const MAX_ERRORS = 20;
const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });
const iso = (t) => (t ? new Date(t).toISOString() : null);

function collector({ store, clock = () => new Date(), settingsOf }) {
  // items: [{ key, row, id? }] -> stores the clean ones; key is reported back with a rejected row.
  async function save(userId, items, source, keyName) {
    const now = clock();
    const errors = [];
    const ok = [];
    let rejected = 0;
    const seen = new Set();
    let duplicates = 0;
    for (const it of items) {
      const c = R.clean(it.row, { now, source, id: it.id || null });
      if (!c.round) {
        rejected += 1;
        if (errors.length < MAX_ERRORS) errors.push({ [keyName]: it.key, reason: c.reason });
        continue;
      }
      if (seen.has(c.round.round_id)) { duplicates += 1; continue; }
      seen.add(c.round.round_id);
      ok.push(c.round);
    }
    let fresh = ok;
    const loose = ok.filter((r) => r.source === 'collector' && !r.given);
    if (loose.length) {
      const times = loose.map((r) => r.observed_at.getTime());
      const near = await store.roundsNear(userId, GAME, new Date(Math.min(...times) - R.WINDOW_MS),
        new Date(Math.max(...times) + R.WINDOW_MS));
      const kept = [];
      for (const r of ok) {
        if (R.duplicateOf(r, near.concat(kept))) duplicates += 1; else kept.push(r);
      }
      fresh = kept;
    }
    const inserted = fresh.length ? await store.insertRounds(userId, GAME, fresh) : 0;
    duplicates += fresh.length - inserted;
    return { inserted, duplicates, rejected, errors };
  }

  // POST /crash/rounds { rounds: [...], source }. The collector's rounds also open its session when none is open.
  async function addRounds(userId, body, { ip = '' } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const source = b.source == null ? 'collector' : String(b.source);
    if (!R.SOURCES.includes(source)) throw err(422, 'invalid', 'Unknown source.', 'source');
    const list = Array.isArray(b.rounds) ? b.rounds : b.multiplier !== undefined ? [b] : null;
    if (!list || !list.length) throw err(422, 'invalid', 'Send at least one round.', 'rounds');
    if (list.length > R.MAX_BATCH) {
      throw err(422, 'too_many_rounds', `At most ${R.MAX_BATCH} rounds at a time.`, 'rounds');
    }
    const out = await save(userId, list.map((row, i) => ({ key: i, row })), source, 'index');
    if (source === 'collector' && out.inserted) await startSession(userId, { ip, quiet: true });
    if (source === 'manual' && out.inserted) await store.audit(userId, 'rounds.manual', { inserted: out.inserted }, ip);
    return out;
  }

  // POST /crash/rounds/import { csv } -> the counts, plus rows (the rows read) and the import is audited.
  async function importCsv(userId, body, { ip = '' } = {}) {
    const text = body && typeof body === 'object' ? body.csv : null;
    const parsed = R.parseCsv(text, { now: clock() });
    const out = await save(userId, parsed.rows.map((x) => ({ key: x.line, row: x.row, id: x.id })), 'csv', 'line');
    await store.audit(userId, 'rounds.imported', { rows: parsed.rows.length, inserted: out.inserted,
      duplicates: out.duplicates, rejected: out.rejected }, ip);
    return { ...out, rows: parsed.rows.length };
  }

  // POST /crash/sessions { action: 'start' }: the collector started (or the open session is reused).
  async function startSession(userId, { ip = '', quiet = false } = {}) {
    const open = await store.openSession(userId, GAME);
    if (open) return { session: sessionOut(open), started: false };
    const s = await settingsOf(userId);
    const row = await store.startSession(userId, GAME, s.demo_mode);
    await store.audit(userId, 'session.started', { by: 'collector', demo: s.demo_mode, implicit: quiet }, ip);
    return { session: sessionOut(row), started: true };
  }

  // POST /crash/sessions { action: 'stop', reason? }: the collector stopped (the app closed or it was turned off).
  async function stopSession(userId, { ip = '', reason = 'collector_stopped' } = {}) {
    const open = await store.openSession(userId, GAME);
    if (!open) return { session: null, stopped: false };
    const why = /^[a-z_]{1,40}$/.test(String(reason)) ? String(reason) : 'collector_stopped';
    await store.endSession(userId, GAME, open.id, why);
    await store.audit(userId, 'session.stopped', { reason: why }, ip);
    return { session: null, stopped: true };
  }

  // The dashboard's collector line: live (a round in the last 2 minutes), idle (its session is open, no round
  // lately) or off; with the last collected round and today's collected count.
  async function status(userId, { collectedToday = 0, session = null } = {}) {
    const last = await store.lastRound(userId, GAME, 'collector');
    const age = last ? clock().getTime() - new Date(last.observed_at).getTime() : Infinity;
    return { status: age <= LIVE_MS ? 'live' : session ? 'idle' : 'off', rounds_today: collectedToday,
      last_multiplier: last ? Number(last.multiplier) : null, last_round_at: last ? iso(last.observed_at) : null };
  }

  return { addRounds, importCsv, startSession, stopSession, status };
}

function sessionOut(s) {
  return { id: String(s.id), demo: Boolean(Number(s.demo)), started_at: iso(s.started_at) };
}

module.exports = { collector, LIVE_MS };
