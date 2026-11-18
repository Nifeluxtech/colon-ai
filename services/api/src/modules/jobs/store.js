// Jobs persistence (0.16.0, migration 0016): every SQL statement of the job queue in one place. sqlStore(db) talks to
// MySQL; memory-store.js is the same interface in memory for tests.
//
// The claim is the heart of it: one UPDATE marks up to `limit` due rows as ours with a fresh random lease token
// (rows already leased by a live runner are not due), then a SELECT reads back exactly the rows carrying that token.
// InnoDB locks each row the UPDATE changes and re-checks the WHERE on the latest version, so two runners (two cron
// processes, cron and a web worker) never take the same row. complete / fail / dead only change a row that still has
// our token: a runner whose lease ran out and whose job was taken over cannot overwrite the new runner's result.
const DUE = "((status IN ('queued','failed') AND run_at <= ?) OR (status = 'running' AND lease_until < ?))";
const LIVE = ['queued', 'running', 'failed'];

function sqlStore(db = require('../../db')) {
  const filters = (o) => {
    const w = [], p = [];
    if (o.types && o.types.length) { w.push('type IN (?)'); p.push(o.types); }
    if (o.users) { if (!o.users.length) return null; w.push('user_id IN (?)'); p.push(o.users); }
    return { sql: w.map((x) => ` AND ${x}`).join(''), p };
  };
  return {
    async insert(j) {
      try {
        const r = await db.query(`INSERT INTO colon_jobs (type, user_id, payload, status, run_at, attempts,
          max_attempts, idempotency_key, ref, created_at, updated_at) VALUES (?,?,?,'queued',?,0,?,?,?,?,?)`,
        [j.type, j.user_id, JSON.stringify(j.payload == null ? {} : j.payload), j.run_at, j.max_attempts,
          j.key || null, j.ref || null, j.now, j.now]);
        return { id: Number(r.insertId), created: true };
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY' || !j.key) throw e;
        const old = await db.one('SELECT id FROM colon_jobs WHERE idempotency_key = ?', [j.key]);
        return { id: old ? Number(old.id) : null, created: false };
      }
    },
    async claim(o) {
      const f = filters(o);
      if (!f) return [];
      let r;
      try {
        r = await db.query(`UPDATE colon_jobs SET status = 'running', lease_token = ?, lease_until = ?,
          attempts = attempts + 1, started_at = ?, updated_at = ? WHERE ${DUE}${f.sql} ORDER BY run_at, id LIMIT ?`,
        [o.token, o.leaseUntil, o.now, o.now, o.now, o.now, ...f.p, o.limit]);
      } catch (e) {
        if (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') return [];   // the next run claims
        throw e;
      }
      if (!Number(r.affectedRows)) return [];
      return db.query('SELECT * FROM colon_jobs WHERE lease_token = ? ORDER BY run_at, id', [o.token]);
    },
    async finish(id, token, s) {
      const r = await db.query(`UPDATE colon_jobs SET status = ?, run_at = COALESCE(?, run_at), last_error = ?,
        attempts = GREATEST(CAST(attempts AS SIGNED) - ?, 0), lease_token = NULL, lease_until = NULL,
        finished_at = ?, updated_at = ? WHERE id = ? AND lease_token = ?`, [s.status, s.run_at || null,
        s.error == null ? null : String(s.error).slice(0, 500), s.giveBack ? 1 : 0, s.now, s.now, id, token]);
      return Number(r.affectedRows) === 1;
    },
    get: (id) => db.one('SELECT * FROM colon_jobs WHERE id = ?', [id]),
    async setStatus(id, from, s) {
      const r = await db.query(`UPDATE colon_jobs SET status = ?, run_at = COALESCE(?, run_at), attempts =
        COALESCE(?, attempts), lease_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status IN (?)`,
      [s.status, s.run_at || null, s.attempts == null ? null : s.attempts, s.now, id, from]);
      return Number(r.affectedRows) === 1;
    },
    async cancelRef(ref, keep, now) {
      const r = await db.query(`UPDATE colon_jobs SET status = 'cancelled', lease_token = NULL, lease_until = NULL,
        updated_at = ? WHERE ref = ? AND status IN ('queued','failed')${keep ? ' AND (idempotency_key IS NULL OR '
        + 'idempotency_key <> ?)' : ''}`, keep ? [now, ref, keep] : [now, ref]);
      return Number(r.affectedRows) || 0;
    },
    async liveRefs(refs) {
      if (!refs.length) return [];
      const rows = await db.query('SELECT DISTINCT ref FROM colon_jobs WHERE ref IN (?) AND status IN (?)',
        [refs, LIVE]);
      return rows.map((x) => x.ref);
    },
    async counts(now) {
      const rows = await db.query('SELECT type, status, COUNT(*) AS n FROM colon_jobs GROUP BY type, status');
      const stale = await db.one(`SELECT COUNT(*) AS n FROM colon_jobs WHERE status = 'running' AND lease_until < ?`,
        [now]);
      return { rows: rows.map((x) => ({ type: x.type, status: x.status, n: Number(x.n) })),
        stale: Number(stale && stale.n) || 0 };
    },
    async list(o) {
      const w = [], p = [];
      if (o.status === 'stale') { w.push("status = 'running' AND lease_until < ?"); p.push(o.now); }
      else if (o.status) { w.push('status = ?'); p.push(o.status); }
      if (o.type) { w.push('type = ?'); p.push(o.type); }
      return db.query(`SELECT * FROM colon_jobs${w.length ? ` WHERE ${w.join(' AND ')}` : ''} ORDER BY id DESC
        LIMIT ?`, [...p, o.limit]);
    },
    async prune(before) {
      const r = await db.query(`DELETE FROM colon_jobs WHERE status IN ('done','cancelled') AND updated_at < ?
        LIMIT 5000`, [before]);
      const c = await db.query('DELETE FROM colon_cron_runs WHERE started_at < ? LIMIT 5000', [before]);
      return { jobs: Number(r.affectedRows) || 0, runs: Number(c.affectedRows) || 0 };
    },
    async recordRun(x) {
      await db.query(`INSERT INTO colon_cron_runs (runner, started_at, finished_at, duration_ms, claimed, done, failed,
        dead, error) VALUES (?,?,?,?,?,?,?,?,?)`, [x.runner, x.started_at, x.finished_at, x.duration_ms, x.claimed,
        x.done, x.failed, x.dead, x.error ? String(x.error).slice(0, 300) : null]);
    },
    lastRun: () => db.one('SELECT * FROM colon_cron_runs ORDER BY started_at DESC, id DESC LIMIT 1'),
    recentRuns: (n) => db.query('SELECT * FROM colon_cron_runs ORDER BY started_at DESC, id DESC LIMIT ?', [n]),
    async ready() {
      const r = await db.query("SHOW TABLES LIKE 'colon_jobs'");
      return r.length > 0;
    },
  };
}

module.exports = { sqlStore, LIVE };
