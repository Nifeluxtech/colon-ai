// Chat: messages (streamed replies), notes and feedback: route wiring only. Handlers: modules/chat/handlers/messages.js
const Router = require('../../router');
const { requireUser } = require('../../../modules/auth').guards;
const { perUser } = require('../../middleware/ratelimit');
const h = require('../../../modules/chat').handlers.messages;

const r = new Router();
r.post('/conversations/:id/messages', requireUser, perUser('chat-send', 20, 60), h.postConversationsByIdMessages);
r.post('/conversations/:id/messages/:mid/regenerate', requireUser, perUser('chat-send', 20, 60),
  h.postConversationsByIdMessagesByMidRegenerate);
r.post('/conversations/:id/messages/:mid/edit', requireUser, perUser('chat-send', 20, 60),
  h.postConversationsByIdMessagesByMidEdit);
r.post('/conversations/:id/messages/:mid/stop', requireUser, h.postConversationsByIdMessagesByMidStop);
r.post('/conversations/:id/notes', requireUser, perUser('chat-note', 30, 600), h.postConversationsByIdNotes);
r.post('/messages/:id/feedback', requireUser, perUser('chat-feedback', 120, 3600), h.postMessagesByIdFeedback);

module.exports = r;
