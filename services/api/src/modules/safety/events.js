// Safety events (migration 0007_safety_events): what the safety layer did, never the conversation itself.
// Stored: stage (input | output | injection), category, action, rule, route, mode, language, request id, user id
// or guest. Message text only as SAFETY_LOG_TEXT says: off (default, nothing), hash (HMAC-SHA-256 keyed with
// APP_SECRET: repeats can be spotted, the text can't be read back) or excerpt (first 80 characters).
// Writing never fails a reply: a database error is logged once and ignored.
const crypto = require('crypto');
const config = require('../../config');
const log = require('../../shared/logger');
const context = require('../../shared/request-context');

const loadDb = (db) => db || require('../../db');

function textFields(text, mode = config.safety.logText) {
  const s = String(text == null ? '' : text);
  if (!s || mode === 'off') return { text_hash: null, excerpt: null };
  if (mode === 'hash') {
    const key = config.auth.appSecret || 'colon-safety';
    return { text_hash: crypto.createHmac('sha256', key).update(s).digest('hex'), excerpt: null };
  }
  if (mode === 'excerpt') return { text_hash: null, excerpt: Array.from(s.replace(/\s+/g, ' ')).slice(0, 80).join('') };
  return { text_hash: null, excerpt: null };
}

/**
 * record({ stage, category, action, rule, source, route, mode, language, req, text }, { db, logText })
 */
async function record(e, { db, logText } = {}) {
  const ctx = context.current();
  const user = e.req && e.req.user ? e.req.user : null;
  const row = {
    request_id: String((ctx && ctx.requestId) || e.requestId || '').slice(0, 128),
    stage: String(e.stage || 'input').slice(0, 16), category: String(e.category || '').slice(0, 32),
    action: String(e.action || '').slice(0, 24), rule: e.rule ? String(e.rule).slice(0, 64) : null,
    source: String(e.source || 'rules').slice(0, 16), route: String(e.route || '').slice(0, 64),
    mode: String(e.mode || '').slice(0, 16), language: String(e.language || '').slice(0, 8),
    user_id: user ? user.id : null, guest: user ? 0 : 1, ...textFields(e.text, logText),
  };
  log.info('safety_event', { stage: row.stage, category: row.category, action: row.action, rule: row.rule,
    route: row.route, guest: Boolean(row.guest) });
  try {
    const keys = Object.keys(row);
    await loadDb(db).query(`INSERT INTO safety_events (${keys.join(', ')}, created_at) VALUES (${keys.map(() => '?')
      .join(', ')}, UTC_TIMESTAMP(3))`, keys.map((k) => row[k]));
  } catch (err) {
    if (err.code !== 'db_not_configured') log.warn('safety_event_failed', { err: String(err.message).slice(0, 120) });
  }
  return row;
}

/* ---------- Admin › Safety (read only) ---------- */
const STAGES = ['input', 'output', 'injection'];
const ACTIONS = ['refuse', 'allow_with_care', 'stopped', 'replaced', 'neutralized', 'redacted'];

// list({ category, action, stage, days, before }) -> { events, counts }
async function list(q = {}, db) {
  const days = [1, 7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 7;
  const before = Number(q.before) > 0 ? Number(q.before) : Number.MAX_SAFE_INTEGER;
  const where = ['e.id < ?', 'e.created_at > UTC_TIMESTAMP() - INTERVAL ? DAY'];
  const args = [before, days];
  if (q.category && /^[a-z_]{2,32}$/.test(q.category)) { where.push('e.category = ?'); args.push(q.category); }
  if (ACTIONS.includes(q.action)) { where.push('e.action = ?'); args.push(q.action); }
  if (STAGES.includes(q.stage)) { where.push('e.stage = ?'); args.push(q.stage); }
  const events = await loadDb(db).query(
    `SELECT e.id, e.created_at, e.stage, e.category, e.action, e.rule, e.source, e.route, e.mode, e.language,
            e.guest, e.request_id, e.text_hash, e.excerpt, e.user_id, u.email AS user_email
       FROM safety_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT 100`, args);
  const counts = await loadDb(db).query(
    `SELECT category, action, COUNT(*) AS n FROM safety_events
      WHERE created_at > UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY category, action`, [days]);
  return { days, events: events.map((r) => ({ ...r, guest: Boolean(r.guest) })),
    counts: counts.map((c) => ({ category: c.category, action: c.action, n: Number(c.n) || 0 })) };
}

module.exports = { record, list, textFields, STAGES, ACTIONS };
