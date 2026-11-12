// Chat: models, usage, conversations and sharing: route wiring only. Handlers: modules/chat/handlers/conversations.js
const Router = require('../../router');
const settings = require('../../../shared/settings');
const { requireUser } = require('../../../modules/auth').guards;
const { limit, perUser } = require('../../middleware/ratelimit');
const h = require('../../../modules/chat').handlers.conversations;

const r = new Router();
r.get('/models', h.getModels);
r.get('/chat/usage', h.getChatUsage);
r.get('/conversations', requireUser, h.getConversations);
r.post('/conversations', requireUser, perUser('chat-create', 60, 600), h.postConversations);
r.delete('/conversations', requireUser, h.deleteConversations);
r.get('/conversations/export', requireUser, perUser('chat-export', 10, 3600), h.getConversationsExport);
r.get('/conversations/:id', requireUser, h.getConversationsById);
r.patch('/conversations/:id', requireUser, h.patchConversationsById);
r.delete('/conversations/:id', requireUser, h.deleteConversationsById);
r.post('/conversations/:id/share', requireUser, settings.feature('sharing'), perUser('chat-share', 30, 3600),
  h.postConversationsByIdShare);
r.delete('/conversations/:id/share', requireUser, h.deleteConversationsByIdShare);
r.get('/shared/:token', limit('shared-view', 120, 600), h.getSharedByToken);
r.post('/shared/:token/report', limit('shared-report', 10, 3600), h.postSharedByTokenReport);

module.exports = r;
