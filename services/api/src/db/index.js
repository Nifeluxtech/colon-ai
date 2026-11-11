const mysql = require('mysql2/promise');
const { db } = require('../config');

let pool = null;
function getPool() {
  if (!db.user || !db.database) return null; // not configured yet
  if (!pool) {
    pool = mysql.createPool({ ...db, waitForConnections: true, connectionLimit: 5, enableKeepAlive: true });
  }
  return pool;
}

async function check() {
  const p = getPool();
  if (!p) return { ok: false, reason: 'not_configured' };
  const t = Date.now();
  try {
    await p.query('SELECT 1');
    return { ok: true, ms: Date.now() - t };
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

module.exports = { getPool, check };
