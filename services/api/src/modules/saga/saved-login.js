// 0.11.2 (owner's request): before Saga hands a sign-in to the user, it uses the login they saved on their phone.
// When a step reaches a password field or a sign-in page (the server's secrets.check, the phone's secret_field, or
// Saga's own requestUserControl for a sign-in), the loop first sends `sign_in {site}` for the page's host: the phone
// (assets/saga/login.js, LoginVault) fills the saved login itself on a trusted https page of that site, after the
// user's one-time approval; the server and the model only learn ok / no_login / not_trusted / wrong_site. No login
// saved (the owner's clarification): the chat's Colon Secured Login form card is offered first (the same store,
// LoginFormActivity -> LoginVault); when the user saves one, Saga signs in with it at once. The usual "Take control"
// hand-over runs only when the user closes the form without saving, the site isn't trusted or is the wrong one, the
// fill failed, the phone can't (no sign_in capability), or a login was already tried on this site in this task (a
// wrong password, a 2FA / one-time code after it). Codes, cards and PINs are never tried: they are the user's.
const tools = require('./tools');

const KINDS = new Set(['password', 'sign_in']);

/** The site (bare host) of an https page, or null. */
function siteOf(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' ? tools.site(u.hostname) : null;
  } catch { return null; }
}

/** Is a saved login worth trying for this hand-over? kind: the secret's kind; caps: the phone's commands. */
const can = (caps) => Array.isArray(caps) && caps.includes('sign_in');
function eligible(kind, url, caps, tried) {
  if (!KINDS.has(kind) || !can(caps)) return null;
  const site = siteOf(url);
  return site && !tried.has(site) ? site : null;
}

async function signIn(c, site) {
  const ack = (await c.command('sign_in', { site }, c.opts).catch(() => null)) || { ok: false, error: 'no_answer' };
  await c.log({ kind: 'action', say: c.say || `Signing in with your saved ${site} login`, tool: 'signIn',
    name: 'sign_in', args: { site }, ok: Boolean(ack.ok), error: ack.ok ? null : String(ack.error || 'error')
      .slice(0, 40), auto: true });
  return ack;
}

/**
 * first({ kind, url, caps, tried, command, opts, log, say, offerForm(site) }) -> null (hand over as before) |
 * { site, result } (signed in) | { end } (the user or the phone ended the task during the form). offerForm shows
 * the Colon Secured Login form card and answers true (a login was saved), false (closed without saving) or why the
 * wait ended. tried: the sites a login was already tried on in this task (the model's own signIn adds to it too).
 */
async function first(c) {
  const site = eligible(c.kind, c.url, c.caps, c.tried);
  if (!site) return null;
  c.tried.add(site);
  let ack = await signIn(c, site);
  if (!ack.ok && ack.error === 'no_login' && typeof c.offerForm === 'function') {
    const saved = await c.offerForm(site);
    if (saved === true) ack = await signIn(c, site);
    else if (saved !== false) return { end: String(saved || 'handoff_ended').slice(0, 40) };
  }
  return ack.ok ? { site, result: ack.result && typeof ack.result === 'object' ? ack.result : {} } : null;
}

/** The loop's helper: viaSaved(kind, say) -> first(...) with the form card shown through the loop's hand-over, and
 *  c.signed(r) called when Saga signed in. c: { o, log, tried, url(), waiting, handBack, opts(say), signed }. */
function forLoop(c) {
  const offerForm = async (site) => {
    const back = await c.waiting(c.handBack(c.o, c.log, { kind: 'login', reason: 'No saved login', tool: 'signIn',
      name: 'sign_in', message: formMessage(site) }));
    if (back !== 'return_to_ai') return back;
    return SAVED_NOTE.test(typeof c.o.takeNote === 'function' ? String(c.o.takeNote() || '') : '');
  };
  return async (kind, say) => {
    const r = await first({ kind, url: c.url(), caps: c.o.caps, tried: c.tried, command: c.o.command, log: c.log,
      say, offerForm, opts: c.opts(say) });
    if (r && r.site) c.signed(r);
    return r;
  };
}

const formMessage = (site) => `Save your ${site} login in Colon Secured Login (it stays on this phone) and Saga signs `
  + 'in for you. Close the form to sign in yourself instead.';
const SAVED_NOTE = /^Login saved for /;

const signedIn = (site, r) => `Colon signed in on ${site} with the login the user saved on their phone (you never `
  + `see it)${r && r.submitted ? ' and sent the form' : ''}. The page is read for you next: check that you are signed `
  + 'in. If it says the password is wrong or asks for a one-time / 2FA code, choose that step again and Colon hands '
  + 'it to the user.';

// The hand-over after a saved login was tried on this site: the user knows why they are asked.
const AFTER_TRY = 'Your saved login didn’t get you in here. Sign in yourself (or enter the code), then tap Return '
  + 'to AI.';
const handoffMessage = (kind, url, tried, message) => (KINDS.has(kind) && tried.has(siteOf(url) || '') ? AFTER_TRY
  : message);

module.exports = { first, forLoop, can, eligible, siteOf, signedIn, handoffMessage, formMessage, SAVED_NOTE, KINDS,
  AFTER_TRY };
