// Account: delete account (handlers for src/http/routes/account/delete.js).

const db = require('../../../db');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const sessions = require('../../auth').sessions;
const { deny } = require('../../auth').guards;
const { checkPassword } = require('./account-common');

// POST /account/delete
const postAccountDelete = async (req) => {
  if (req.user.role === 'super_admin') {
    const others = await db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND id <> ?",
      [req.user.id]);
    if (!others.n) deny(409, 'last_super_admin',
      'You are the only Super Admin. Hand over the role before deleting your account.');
  }
  await checkPassword(req, req.body.password);
  if (req.body.confirm !== 'DELETE') v.fail('confirm', 'Type DELETE to confirm.');
  await audit(req, 'account.deleted', { actorId: req.user.id, targetType: 'user', targetId: req.user.id,
    meta: { email: req.user.email } });
  await db.query('DELETE FROM users WHERE id = ?', [req.user.id]); // sessions and tokens cascade
  return [200, { ok: true }, { 'Set-Cookie': sessions.clear() }];
};

module.exports = { postAccountDelete };
