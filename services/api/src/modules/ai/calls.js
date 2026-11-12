// AI call log (Phase 4): one row per provider attempt, so the Admin Dashboard can show requests, errors,
// provider success rates and latency from stored data. Logging never delays or breaks a reply.
const crypto = require('crypto');
const log = require('../../shared/logger');

function rowsFor({ mode = '', route = '', guest = false, attempts = [], code = null }) {
  const rid = crypto.randomBytes(8).toString('hex');
  const list = attempts.length ? attempts : [{ provider: '', model: '', ok: false, code: code || 'no_attempt', ms: 0 }];
  return list.map(a => [
    rid, String(mode || '').slice(0, 16), String(route || '').slice(0, 16), String(a.provider || '').slice(0, 32),
      String(a.model || '').slice(0, 128),
    a.ok ? 1 : 0, a.ok ? null : String(a.code || code || 'error').slice(0, 32), Number(a.status) || null, Math.max(0,
      Math.round(Number(a.ms) || 0)), guest ? 1 : 0,
  ]);
}

async function record(info, db) {
  try {
    const rows = rowsFor(info);
    if (!rows.length) return;
    await (db || require('../../db')).query(
      (`INSERT INTO ai_calls (request_id, mode, route, provider, model, ok, code, http_status, ms, guest, `
        + `created_at) VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(3))').join(',')}`),
      rows.flat()
    );
  } catch (e) {
    log.warn('ai_calls_log_failed', { err: String(e.message).slice(0, 120) });
  }
}

module.exports = { record, rowsFor };
