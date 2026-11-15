// 0.11.4 (owner's report on 0.11.3: "Login to GitHub" on a phone already signed in to github.com, the dashboard
// saying "Good evening, Nifeluxtech!", ended with "Saga needs you: Your saved login didn't get you in here"). Saga
// called signIn on the dashboard; the phone found no login form there (no_form), which counted as a failed saved
// login, and the next sign-in request handed the page to the user with that message. Now, on any site, the page is
// read before a saved login or a sign-in hand-over: already signed in (no password / code / card / PIN field, and an
// account menu, Sign out / Log out, "Signed in as …" or a greeting with a name, not on a /login page) means the sign-in
// is done. No form is never a failed login, and a sign-in is handed over only when the page holds a secret field or
// is a sign-in page; "your saved login didn't get you in" only with a secret field still there.
//   detect(page) -> { state: 'secret' | 'signed_in' | 'sign_in_page' | 'unknown', kind?, who?, host }
//   forLoop(c) -> { state(), before(kind, say, known), already(st), noForm(site), current() }
const secrets = require('./secrets');
const goal = require('./goal');

const SECRET = new Set(['password', 'one_time_code', 'card', 'pin']);
const SIGN_OUT = /\b(?:sign ?out|log ?out|logout|signout|log off)\b/i;
const OUT_HREF = /(?:^|[/?&=_-])(?:log-?out|sign-?out|signout|logoff|sign_out|log_out)(?:$|[/?&=._-])/i;
const SIGNED_AS = /\b(?:signed|logged) in as:?\s+@?([\p{L}\p{N}][\p{L}\p{N}._@-]{1,63})/iu;
const GREETING = new RegExp(String.raw`\b(?:good (?:morning|afternoon|evening|day)|welcome back|welcome|hi|hello|hey)`
  + String.raw`\s*,?\s+@?([\p{L}][\p{L}\p{N}._-]{1,38})\s*(?=[!.,\u{1F44B}\n]|$)`, 'giu');
const NOT_NAME = new Set(['there', 'to', 'guest', 'user', 'back', 'everyone', 'all', 'friend', 'again', 'sign', 'log',
  'visitor', 'the', 'and', 'you', 'home', 'world', 'folks', 'stranger', 'customer']);
const ACCOUNT = new RegExp(String.raw`\b(?:(?:open )?user (?:navigation )?menu|account menu|profile menu|your profile|`
  + String.raw`view profile|my account|account settings|manage your (?:google )?account|google account:|switch account|`
  + String.raw`your account|my dashboard)\b`, 'i');
const SIGN_IN_CTA = /^\s*(?:sign ?in|log ?in|login|signin|sign ?up|create (?:an )?account|register|join)\s*$/i;
const GOOGLE_WHO = /google account:\s*([^()\n]{2,60}?)\s*(?:\(|\n|$)/i;
const ACTIONABLE = new Set(['a', 'button', 'summary', 'li', '']);

const secretKind = (e) => (SECRET.has(e.secret) ? e.secret : (() => { const k = secrets.fieldKind(e);
  return SECRET.has(k) ? k : null; })());
const label = (e) => `${e.text || ''} ${e.label || ''}`.replace(/\s+/g, ' ').trim();
function greeting(s) {
  for (const m of String(s).matchAll(GREETING)) if (!NOT_NAME.has(m[1].toLowerCase())) return m[1];
  return null;
}

/** What the page says about signing in. page: a (redacted) getPageContent result { url, title, text, elements }. */
function detect(page) {
  if (!page || typeof page !== 'object') return { state: 'unknown', host: '' };
  const host = goal.hostOf(page.url);
  const els = (Array.isArray(page.elements) ? page.elements : []).filter((e) => e && typeof e === 'object');
  const field = els.map(secretKind).find(Boolean);
  if (field) return { state: 'secret', kind: field, host };
  const loginPage = secrets.pageKind(page.url) === 'sign_in' || els.some((e) => e.form_secret
    || /\b(?:username|webauthn)\b/i.test(String(e.autocomplete || '')));
  if (loginPage) return { state: 'sign_in_page', host };
  const texts = els.map(label).filter(Boolean).join('\n');
  const body = `${page.title || ''}\n${String(page.text || '').slice(0, 8000)}\n${texts}`;
  const out = els.some((e) => SIGN_OUT.test(label(e)) || OUT_HREF.test(String(e.href || '')));
  const as = SIGNED_AS.exec(body);
  const greet = greeting(body);
  const account = ACCOUNT.test(texts);
  const cta = els.some((e) => ACTIONABLE.has(String(e.tag || '').toLowerCase()) && SIGN_IN_CTA.test(label(e)));
  if (!(out || as || ((greet || account) && !cta))) return { state: 'unknown', host, seen: true };
  const g = GOOGLE_WHO.exec(texts);
  const who = (as && as[1]) || greet || (g && g[1].trim()) || '';
  return { state: 'signed_in', who: who.slice(0, 60), host };
}

// A goal that is only "log in to <site>" (nothing else to do once signed in).
const PURE = new RegExp(String.raw`^\s*(?:please\s+)?(?:(?:can|could) you\s+)?(?:(?:log|sign) ?into\s|`
  + String.raw`(?:log ?-?in|sign ?-?in|signin|login)(?:\s+(?:to|into|on|at))?\s)\s*(?:my\s+)?(.{2,60}?)`
  + String.raw`(?:\s+account)?(?:\s+(?:please|for me|now))?\s*[.!]?\s*$`, 'i');
function pureLogin(text, host) {
  const m = PURE.exec(String(text || ''));
  if (!m || !host) return false;
  const what = m[1].toLowerCase().replace(/^www\./, '').trim();
  if (what.split(/\s+/).length > 3 || /\b(?:and|then|open|go|check|find|search|buy|post|send)\b/.test(what)) {
    return false;
  }
  const want = goal.targetHost(what);
  if (want) return goal.sameSite(host, want);
  return what.replace(/[^a-z0-9]/g, '') === host.split('.')[0].replace(/[^a-z0-9]/g, '');
}

const alreadyLine = (site, who) => `You're already signed in to ${site}${who ? ` as ${who}` : ''}.`;
const ALREADY = (site, who) => `${alreadyLine(site, who)} The page shows a signed-in account (no password or code `
  + 'field), so no sign-in is needed and nothing is handed to the user. Do not call signIn or requestUserControl '
  + `for a sign-in on ${site}. If the task was only to sign in, finish now with "${alreadyLine(site, who)}"; otherwise `
  + 'continue the task.';
const NO_FORM = 'signIn found no sign-in form on this page and the page does not show a signed-in account. Nothing '
  + 'was tried with the saved login. Open the site\'s sign-in page (click its "Sign in" / "Log in" link, or openUrl '
  + 'its /login address), call getPageContent, then call signIn.';
const NO_FIELD = 'Not handed to the user: this page has no password or code field and is not a sign-in page. If you '
  + 'are signed in, finish or continue; otherwise open the site\'s sign-in page (its "Sign in" link or /login), call '
  + 'getPageContent, then call signIn.';
const MAX_NO_FIELD = 2;

/**
 * The loop's helper. c: { o, goal, log, observe, url(), page(), keep(page), opts(), viaSaved(kind, say), tried }.
 * before(...) -> { end } (the task ended) | { done, result } (only a sign-in was asked, already signed in) |
 *   { skip: true } (go on deciding) | { hand: true, secret } (hand the page to the user as before).
 */
function forLoop(c) {
  let refused = 0;
  const current = () => detect(c.page());
  async function state() {
    let p = c.page();
    if (!p && (!Array.isArray(c.o.caps) || c.o.caps.includes('get_page_content'))) {
      const a = await Promise.resolve(c.o.command('get_page_content', {}, c.opts())).catch(() => null);
      if (a && a.ok && a.result && typeof a.result === 'object') { p = secrets.redactContent(a.result); c.keep(p); }
    }
    return detect(p);
  }
  async function already(st) {
    const site = st.host || goal.hostOf(c.url()) || 'this site';
    await c.log({ kind: 'action', say: `Already signed in to ${site}`, tool: 'signIn', name: 'sign_in',
      args: { site }, ok: true, error: null, auto: true });
    if (pureLogin(c.goal, st.host)) return { done: alreadyLine(site, st.who), result: `Signed in to ${site}` };
    c.observe(ALREADY(site, st.who));
    return { skip: true };
  }
  async function noForm(site) {
    if (site) c.tried.delete(site);           // nothing was filled: the saved login was not tried here
    const st = await state();
    if (st.state === 'signed_in') return already(st);
    c.observe(NO_FORM);
    return { skip: true };
  }
  async function before(kind, say, known) {
    const st = known ? { state: known } : await state();
    if (st.state === 'signed_in') return already(st);
    // A page read with no secret field and no sign-in form: nothing for a saved login to fill, nothing to hand over.
    const refuse = () => (refused++ < MAX_NO_FIELD ? (c.observe(NO_FIELD), { skip: true })
      : { hand: true, secret: false });
    if (st.state === 'unknown' && st.seen) return refuse();
    const v = await c.viaSaved(kind, say);
    if (v && v.end) return { end: v.end };
    if (v && v.site) return { skip: true };
    if (v && v.noForm) return noForm(v.noForm);
    if (st.state === 'secret' || st.state === 'sign_in_page') return { hand: true, secret: st.state === 'secret' };
    return refuse();
  }
  return { state, before, already, noForm, current };
}

module.exports = { detect, pureLogin, forLoop, alreadyLine, ALREADY, NO_FORM, NO_FIELD, MAX_NO_FIELD };
