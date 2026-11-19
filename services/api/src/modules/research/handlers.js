// Deep research HTTP handlers (0.17.0, Blueprint D16; routes in src/http/routes/research.js). Signed-in users only;
// every run is scoped to its owner (another user's id is a 404).
//   POST /conversations/:id/research { question, confirm }   start one (confirm: true after the app asked; without
//        it the answer is 409 consent_required with the credit cost, and nothing is charged or saved)
//   GET  /conversations/:id/research                         this chat's runs (newest first), for progress
//   GET  /research/:id                                       one run's progress
//   POST /research/:id/cancel                                stop it (credits refunded)
const v = require('../../shared/validate');

const svc = () => require('./index').instance();

const postConversationsByIdResearch = async (req) => {
  const chat = require('../chat');
  const { replyLanguage } = require('../ai').prompts;
  const conv = await chat.store.getConv(req.user.id, req.params.id);
  const question = String((req.body && req.body.question) || '').replace(/\r\n?/g, '\n').trim();
  if (question.length < 3) v.fail('question', 'Type the research question first.');
  if (question.length > 4000) v.fail('question', 'Keep the question under 4,000 characters.');
  const out = await svc().start({ user: req.user, conv, question, consent: req.body.confirm === true,
    language: replyLanguage(req.user.language, question), chat: {
      addUser: async (text) => {
        const m = await chat.store.insertMessage(conv, { role: 'user', content: text, origin: 'research' });
        await chat.store.touch(conv, { preview: text, title: conv.title === 'New chat' ? chat.store.titleFrom(text)
          : null });
        return m;
      },
      addProgress: (text) => chat.store.insertMessage(conv, { role: 'assistant', content: text, origin: 'research',
        status: 'complete', mode: 'research' }),
    } });
  return [201, { ...out, conversation: chat.store.convOut(await chat.store.getConv(req.user.id, conv.id)) }];
};

const getConversationsByIdResearch = async (req) => {
  const conv = await require('../chat').store.getConv(req.user.id, req.params.id);
  return [200, { runs: await svc().forConversation(req.user.id, conv.id) }];
};

const getResearchById = async (req) => [200, { run: await svc().status(req.user.id, req.params.id) }];
const postResearchByIdCancel = async (req) => [200, { run: await svc().cancel(req.user.id, req.params.id) }];

module.exports = { postConversationsByIdResearch, getConversationsByIdResearch, getResearchById,
  postResearchByIdCancel };
