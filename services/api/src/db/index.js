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
    return { ok: false, reason: e.code || 'error' };
  }
}

module.exports = { getPool, check };
