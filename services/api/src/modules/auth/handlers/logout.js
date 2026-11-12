// Auth: sign out (handlers for src/http/routes/auth/logout.js).

const audit = require('../../../shared/audit');
const sessions = require('../sessions');

// POST /auth/logout
const postAuthLogout = async (req) => {
  if (req.user) {
    await sessions.destroy(req.user.session_id);
    await audit(req, 'auth.logout', { actorId: req.user.id });
  }
  return [200, { ok: true }, { 'Set-Cookie': sessions.clear() }];
};

module.exports = { postAuthLogout };
