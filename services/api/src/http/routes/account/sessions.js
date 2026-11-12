// Account: signed-in sessions: route wiring only. Handlers: modules/account/handlers/sessions.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const h = require('../../../modules/account').handlers.sessions;

const r = new Router();
r.get('/account/sessions', requireUser, h.getAccountSessions);
r.delete('/account/sessions/:id', requireUser, h.deleteAccountSessionsById);
r.post('/account/sessions/revoke-others', requireUser, h.postAccountSessionsRevokeOthers);

module.exports = r;
