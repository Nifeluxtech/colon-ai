const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { db } = require('../config');
const log = require('../shared/logger');

let pool = null;
function getPool() {
  if (!db.user || !db.database) return null; // not configured yet
  if (!pool) {
    pool = mysql.createPool({
      ...db, waitForConnections: true, connectionLimit: 5, enableKeepAlive: true,
      timezone: 'Z', dateStrings: false, charset: 'utf8mb4',
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const p = getPool();
  if (!p) throw Object.assign(new Error('database not configured'), { status: 503, code: 'db_not_configured' });
  const [rows] = await p.query(sql, params);
  return rows;
}

async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function check() {
  const p = getPool();
  if (!p) return { ok: false, reason: 'not_configured' };
  const t = Date.now();
  try {
    await p.query('SELECT 1');
    return { ok: true, ms: Date.now() - t, migrations: migrated };
  } catch (e) {
    // MySQL's message names user@host and "using password: YES/NO", never the password itself.
    return {
      ok: false,
      reason: e.code || 'error',
      detail: String(e.sqlMessage || e.message || '').slice(0, 160),
      host: db.host,
      password_set: Boolean(db.password),
    };
  }
}

// Applies database/migrations/*.sql once each, in order. Safe to run on every boot:
// a MySQL named lock stops two recycled workers migrating at the same time.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../database/migrations');
let migrated = [];
async function migrate() {
  const p = getPool();
  if (!p || !fs.existsSync(MIGRATIONS_DIR)) return;
  const conn = await p.getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('colon_migrate', 10) AS got");
    if (!lock.got) return;
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(64) NOT NULL PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const [done] = await conn.query('SELECT id FROM schema_migrations');
    const have = new Set(done.map(r => r.id));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      const id = f.replace(/\.sql$/, '');
      if (have.has(id)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      for (const stmt of sql.split(/;\s*\n/).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) {
        await conn.query(stmt);
      }
      await conn.query('INSERT IGNORE INTO schema_migrations (id) VALUES (?)', [id]);
      log.info('migration_applied', { id });
    }
    const [all] = await conn.query('SELECT id FROM schema_migrations ORDER BY id');
    migrated = all.map(r => r.id);
  } finally {
    await conn.query("SELECT RELEASE_LOCK('colon_migrate')").catch(() => {});
    conn.release();
  }
}

module.exports = { getPool, query, one, check, migrate };
