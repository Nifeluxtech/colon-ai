// Account: signed-in sessions (handlers for src/http/routes/account/sessions.js).

const db = require('../../../db');
const audit = require('../../../shared/audit');
const sessions = require('../../auth').sessions;

// GET /account/sessions
const getAccountSessions = async (req) => {
  const rows = await db.query(
    'SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > UTC_TIMESTAMP() ORDER BY last_seen_at DESC',
    [req.user.id]
  );
  return [200, { sessions: rows.map(s => ({ ...s, current: s.id === req.user.session_id })) }];
};

// DELETE /account/sessions/:id
const deleteAccountSessionsById = async (req) => {
  await db.query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  await audit(req, 'account.session_revoked', { actorId: req.user.id, targetType: 'session', targetId: req.params.id });
  return [200, { ok: true }];
};

// POST /account/sessions/revoke-others
const postAccountSessionsRevokeOthers = async (req) => {
  await sessions.destroyAll(req.user.id, req.user.session_id);
  await audit(req, 'account.sessions_revoked_all', { actorId: req.user.id });
  return [200, { ok: true }];
};

module.exports = { getAccountSessions, deleteAccountSessionsById, postAccountSessionsRevokeOthers };
