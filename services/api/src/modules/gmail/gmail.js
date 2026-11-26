// Gmail, send only (0.40.0). The user connects their Gmail once (Google OAuth, scope gmail.send: Google's
// "sensitive" tier, so no paid security review); Colon keeps only the refresh token, encrypted (APP_SECRET), and
// sends an email only when the user taps Approve on its card. Colon never reads the mailbox.
//   authUrl(userId)          -> Google's consent page (state = signed user id + expiry, so the callback works
//                               in the phone's own browser, which has no Colon session: Google blocks WebViews)
//   finish(code, state)      -> { userId, email } after saving the connection
//   status(userId) · disconnect(userId) · send(userId, { to, cc, subject, body }) -> { id }
const crypto = require('crypto');
const config = require('../../config');
const { encrypt, decrypt } = require('../../shared/crypto');
const mime = require('./mime');

const SCOPE = 'openid email https://www.googleapis.com/auth/gmail.send';
const STATE_MS = 15 * 60 * 1000;
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

function settings() {
  const g = config.gmail || {};
  return { clientId: config.auth.googleClientId, secret: g.clientSecret,
    redirect: g.redirect || `${(config.payments.apiUrl || '').replace(/\/+$/, '')}/gmail/callback` };
}
const configured = () => { const s = settings(); return Boolean(s.clientId && s.secret && config.auth.appSecret); };

function sign(text) {
  return crypto.createHmac('sha256', `gmail:${config.auth.appSecret}`).update(text).digest('base64url');
}
function makeState(userId, now = Date.now()) {
  const body = `${userId}.${now + STATE_MS}.${crypto.randomBytes(8).toString('base64url')}`;
  return `${body}.${sign(body)}`;
}
function readState(state, now = Date.now()) {
  const p = String(state || '').split('.');
  if (p.length !== 4) return null;
  const body = p.slice(0, 3).join('.'), mac = Buffer.from(p[3]), want = Buffer.from(sign(body));
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want) || Number(p[1]) < now) return null;
  return p[0];
}

function create({ store, fetch = globalThis.fetch } = {}) {
  async function google(url, form) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString() });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw err(502, 'gmail_auth', d.error_description || 'Google didn’t accept the Gmail connection.');
    return d;
  }
  function authUrl(userId) {
    if (!configured()) throw err(503, 'gmail_off', 'Gmail isn’t set up on this Colon server yet.');
    const s = settings();
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: s.clientId,
      redirect_uri: s.redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
      include_granted_scopes: 'true', state: makeState(userId) }).toString();
  }
  async function finish(code, state) {
    const userId = readState(state);
    if (!userId) throw err(400, 'gmail_state', 'That Gmail link expired. Connect Gmail again from Colon.');
    const s = settings();
    const t = await google('https://oauth2.googleapis.com/token', { code: String(code || ''), client_id: s.clientId,
      client_secret: s.secret, redirect_uri: s.redirect, grant_type: 'authorization_code' });
    if (!t.refresh_token) throw err(502, 'gmail_auth', 'Google didn’t give Colon access. Try connecting again.');
    if (!String(t.scope || '').includes('gmail.send')) {
      throw err(400, 'gmail_scope', 'Tick “Send email on your behalf” on Google’s page to let Colon send.');
    }
    const email = emailOf(t.id_token);
    await store.save(userId, { email, token: encrypt(t.refresh_token) });
    return { userId, email };
  }
  async function status(userId) {
    const row = await store.get(userId);
    return { configured: configured(), connected: Boolean(row), email: row ? row.email : null };
  }
  async function disconnect(userId) {
    const row = await store.get(userId);
    if (!row) return;
    await store.remove(userId);
    const token = (() => { try { return decrypt(row.token); } catch { return ''; } })();
    if (token) await google('https://oauth2.googleapis.com/revoke', { token }).catch(() => {});
  }
  async function send(userId, msg) {
    const row = await store.get(userId);
    if (!row) throw err(409, 'gmail_not_connected', 'Connect your Gmail first.');
    const s = settings();
    let access;
    try {
      access = (await google('https://oauth2.googleapis.com/token', { client_id: s.clientId, client_secret: s.secret,
        refresh_token: decrypt(row.token), grant_type: 'refresh_token' })).access_token;
    } catch (e) {
      throw err(409, 'gmail_reconnect', 'Colon lost access to your Gmail. Connect it again in Settings.');
    }
    const raw = mime.build({ from: row.email, ...mime.check(msg) });
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw err(502, 'gmail_send', (d.error && d.error.message) || 'Gmail didn’t send the email.');
    return { id: d.id || null, from: row.email };
  }
  return { authUrl, finish, status, disconnect, send };
}

function emailOf(idToken) {
  try {
    const p = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return String(p.email || '').slice(0, 190) || null;
  } catch { return null; }
}

module.exports = { create, configured, makeState, readState, SCOPE };
