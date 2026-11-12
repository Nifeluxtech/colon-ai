// Helpers shared by the account handlers.
const db = require('../../../db');
const v = require('../../../shared/validate');
const { verifyPassword } = require('../../../shared/crypto');

async function checkPassword(req, password) {
  const row = await db.one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (row.password_hash && !(await verifyPassword(String(password || ''), row.password_hash))) {
    v.fail('password', 'Your password is incorrect.');
  }
}

module.exports = { checkPassword };
