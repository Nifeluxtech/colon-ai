// Deep research jobs (v0.17.0, Blueprint D16): route wiring only. Handlers: modules/research/handlers.js
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/research').handlers;

const r = new Router();
r.post('/conversations/:id/research', requireUser, perUser('research-start', 6, 3600),
  h.postConversationsByIdResearch);
r.get('/conversations/:id/research', requireUser, h.getConversationsByIdResearch);
r.get('/research/:id', requireUser, h.getResearchById);
r.post('/research/:id/cancel', requireUser, h.postResearchByIdCancel);

module.exports = r;
