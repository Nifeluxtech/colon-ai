// Memory (v0.15.0, Blueprint B9): route wiring only. Handlers: modules/memory/handlers.js
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/memory').handlers;

const r = new Router();
r.get('/memory', requireUser, h.getMemory);
r.put('/memory/consent', requireUser, perUser('memory-consent', 30, 3600), h.putMemoryConsent);
r.post('/memories', requireUser, perUser('memory-write', 120, 3600), h.postMemories);
r.patch('/memories/:id', requireUser, perUser('memory-write', 120, 3600), h.patchMemoriesById);
r.delete('/memories/:id', requireUser, h.deleteMemoriesById);
r.delete('/memories', requireUser, h.deleteMemories);

module.exports = r;
