// Account: profile and password (handlers for src/http/routes/account/profile.js).

const db = require('../../../db');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const { hashPassword } = require('../../../shared/crypto');
const sessions = require('../../auth').sessions;
const { publicUser } = require('../../auth').guards;
const { checkPassword } = require('./account-common');

// PATCH /account/profile
const patchAccountProfile = async (req) => {
  const name = req.body.name !== undefined ? v.name(req.body.name) : req.user.name;
  const language = req.body.language !== undefined ? v.language(req.body.language) : req.user.language;
  await db.query('UPDATE users SET name = ?, language = ? WHERE id = ?', [name, language, req.user.id]);
  await audit(req, 'account.profile_updated', { actorId: req.user.id });
  return [200, { user: publicUser({ ...req.user, name, language }) }];
};

// POST /account/password
const postAccountPassword = async (req) => {
  const next = v.password(req.body.new_password, 'new_password');
  await checkPassword(req, req.body.current_password);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.user.id]);
  await sessions.destroyAll(req.user.id, req.user.session_id);
  await audit(req, 'account.password_changed', { actorId: req.user.id });
  return [200, { ok: true }];
};

module.exports = { patchAccountProfile, postAccountPassword };
