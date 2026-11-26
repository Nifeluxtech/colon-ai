// Gmail routes (0.40.0): status, connect (Google's page), the OAuth callback, disconnect, and send (only after the
// user tapped Approve on the email card in the app).
const config = require('../../config');
const { create } = require('./gmail');
const { sqlStore } = require('./store');

let shared = null;
const gmail = () => shared || (shared = create({ store: sqlStore() }));
const back = (q) => ({ Location: `${String(config.urls.chat).replace(/\/+$/, '')}/#/settings?s=chat&gmail=${q}` });

const getGmail = async (req) => [200, await gmail().status(req.user.id)];
const postGmailConnect = async (req) => [200, { url: gmail().authUrl(req.user.id) }];
const getGmailCallback = async (req) => {
  const q = req.query || new URLSearchParams();
  if (q.get('error')) return [302, {}, back('cancelled')];
  try {
    await gmail().finish(q.get('code'), q.get('state'));
    return [302, {}, back('connected')];
  } catch (e) {
    return [302, {}, back(e.code === 'gmail_scope' ? 'scope' : 'failed')];
  }
};
const deleteGmail = async (req) => { await gmail().disconnect(req.user.id); return [200, { ok: true }]; };
const postGmailSend = async (req) => {
  const b = req.body || {};
  return [200, { ok: true, ...(await gmail().send(req.user.id, { to: b.to, cc: b.cc, subject: b.subject,
    body: b.body })) }];
};

module.exports = { getGmail, postGmailConnect, getGmailCallback, deleteGmail, postGmailSend,
  _set: (g) => { shared = g; } };
