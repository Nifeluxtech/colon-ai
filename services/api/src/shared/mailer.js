// Transactional email through Brevo's HTTP API (free tier). Without BREVO_API_KEY,
// mail is skipped and logged, so sign-up still works while email is being set up.
const { mail } = require('../config');
const log = require('./logger');

async function send({ to, subject, html, text }) {
  if (!mail.brevoKey) { log.warn('mail_skipped_no_key', { subject }); return false; }
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': mail.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: mail.from, name: mail.fromName }, to: [{ email: to }], subject,
        htmlContent: html, textContent: text }),
    });
    if (!r.ok) { log.error('mail_failed', { status: r.status }); return false; }
    return true;
  } catch (e) {
    log.error('mail_failed', { err: e.message });
    return false;
  }
}

const shell = (title, body, cta, url) => [
  '<!doctype html><html><body style="margin:0;background:#07080c;'
    + 'font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#f3f4f8">',
  '<div style="max-width:480px;margin:0 auto;padding:32px 24px">',
  '<div style="font-weight:800;letter-spacing:.14em;color:#ff8a3d">COLON</div>',
  `<h1 style="font-size:22px;margin:24px 0 8px">${title}</h1>`,
  `<p style="color:#b4bccb;line-height:1.6">${body}</p>`,
  `<a href="${url}" style="display:inline-block;margin:16px 0;padding:14px 22px;border-radius:12px;`
    + `background:#ff6a1a;color:#fff;text-decoration:none;font-weight:600">${cta}</a>`,
  `<p style="color:#6b7383;font-size:13px;line-height:1.6">If the button doesn't work, open this link:<br>${url}</p>`,
  '<p style="color:#6b7383;font-size:12px">Colon AI by Nifelux</p></div></body></html>',
].join('\n');

module.exports = {
  send,
  verifyEmail: (to, url) => send({ to, subject: 'Confirm your email for Colon AI',
    html: shell('Confirm your email', 'Tap below to confirm this address. The link works for 24 hours.',
      'Confirm email', url),
    text: `Confirm your email for Colon AI: ${url}` }),
  resetPassword: (to, url) => send({ to, subject: 'Reset your Colon AI password',
    html: shell('Reset your password',
      "Someone asked to reset your password. If that wasn't you, ignore this email. The link works for 1 hour.",
      'Choose a new password', url),
    text: `Reset your Colon AI password: ${url}` }),
};
