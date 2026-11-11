const db = require('../db');
const { auth, isProd } = require('../config');
const { randomToken, sha256 } = require('../lib/crypto');

function cookie(value, maxAgeSec) {
  const parts = [`${auth.cookieName}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isProd) parts.push('Secure');
  if (auth.cookieDomain) parts.push(`Domain=${auth.cookieDomain}`);
  return parts.join('; ');
}

async function create(req, userId) {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL ? DAY)`,
    [userId, sha256(token), String(req.headers['user-agent'] || '').slice(0, 255), req.ip, auth.sessionDays]
  );
  return cookie(token, auth.sessionDays * 86400);
}

const clear = () => cookie('', 0);

// Loads the signed-in user. Sliding expiry: last_seen refreshes at most every 10 minutes.
async function load(req) {
  const token = req.cookies[auth.cookieName];
  if (!token || token.length > 100) return null;
  const row = await db.one(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.name, u.language, u.role,
            u.email_verified_at, u.totp_enabled, u.created_at, (u.password_hash IS NOT NULL) AS has_password,
            (u.google_sub IS NOT NULL) AS has_google
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`,
    [sha256(token)]
  );
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 10 * 60 * 1000) {
    await db.query(
      'UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(), expires_at = UTC_TIMESTAMP() + INTERVAL ? DAY, ip = ? WHERE id = ?',
      [auth.sessionDays, req.ip, row.session_id]
    );
  }
  return row;
}

const destroy = (sessionId) => db.query('DELETE FROM sessions WHERE id = ?', [sessionId]);
const destroyAll = (userId, exceptId = 0) => db.query('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, exceptId]);

module.exports = { create, clear, load, destroy, destroyAll };
