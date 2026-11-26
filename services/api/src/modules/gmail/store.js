// Gmail connections (0.40.0, migration 0031): one per user, the refresh token encrypted (shared/crypto).
const db = require('../../db');

const sqlStore = () => ({
  get: (userId) => db.one('SELECT user_id, email, token FROM colon_gmail WHERE user_id = ?', [userId]),
  save: (userId, { email, token }) => db.query(`INSERT INTO colon_gmail (user_id, email, token, created_at)
    VALUES (?,?,?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE email = VALUES(email), token = VALUES(token),
    created_at = VALUES(created_at)`, [userId, email, token]),
  remove: (userId) => db.query('DELETE FROM colon_gmail WHERE user_id = ?', [userId]),
});

function memoryStore() {
  const rows = new Map();
  return {
    async get(userId) { return rows.get(String(userId)) || null; },
    async save(userId, r) { rows.set(String(userId), { user_id: userId, ...r }); },
    async remove(userId) { rows.delete(String(userId)); },
  };
}

module.exports = { sqlStore, memoryStore };
