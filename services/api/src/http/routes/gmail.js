// Gmail, send only (0.40.0): route wiring only. Handlers: modules/gmail/handlers.js
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser, limit } = require('../middleware/ratelimit');
const h = require('../../modules/gmail').handlers;

const r = new Router();
r.get('/gmail', requireUser, h.getGmail);
r.post('/gmail/connect', requireUser, perUser('gmail-connect', 20, 3600), h.postGmailConnect);
// Google sends the phone's own browser here (no Colon session there): the signed state names the user.
r.get('/gmail/callback', limit('gmail-callback', 30, 3600), h.getGmailCallback);
r.delete('/gmail', requireUser, h.deleteGmail);
r.post('/gmail/send', requireUser, perUser('gmail-send', 30, 3600), h.postGmailSend);

module.exports = r;
