// Goal check for Saga's finish (0.10.6). Saga used to be able to say "I have reached the GitHub login page" without
// opening anything: the finish was taken on its word. Now a finish is checked against where the browser really is
// (the URL and title of the last page this task saw, or the phone's page_state) before the task may end as done:
//   - a "go to / open X" goal that names a site needs the current URL's host to be that site;
//   - a goal that asks for a sign-in / login page needs the URL or title to look like one;
//   - a finish before any successful browser action in this task is refused when the page can't be confirmed.
// A refused finish goes back to Saga as an observation ("not done yet: the page is …"). After MAX_REFUSALS the
// finish is accepted, so a check that is wrong can never trap a task (the step limit still applies).
const MAX_REFUSALS = 2;

// Well-known names people use for a site -> its host (matches subdomains too: github.com covers gist.github.com).
const SITES = {
  github: 'github.com', gitlab: 'gitlab.com', google: 'google.com', gmail: 'google.com', youtube: 'youtube.com',
  facebook: 'facebook.com', instagram: 'instagram.com', twitter: 'x.com', linkedin: 'linkedin.com',
  wikipedia: 'wikipedia.org', amazon: 'amazon.com', jumia: 'jumia.com.ng', konga: 'konga.com', reddit: 'reddit.com',
  whatsapp: 'whatsapp.com', tiktok: 'tiktok.com', netflix: 'netflix.com', paypal: 'paypal.com', yahoo: 'yahoo.com',
  outlook: 'live.com', microsoft: 'microsoft.com', apple: 'apple.com', stackoverflow: 'stackoverflow.com',
  'stack overflow': 'stackoverflow.com', npm: 'npmjs.com', vercel: 'vercel.com', netlify: 'netlify.app',
  cloudflare: 'cloudflare.com', jamb: 'jamb.gov.ng', waec: 'waec.org.ng', nairaland: 'nairaland.com',
  chatgpt: 'chatgpt.com', openai: 'openai.com', canva: 'canva.com', figma: 'figma.com', notion: 'notion.so',
};
// Hosts that belong to the same site (x.com is still twitter.com, live.com sign-in is microsoftonline/login.live).
const ALSO = { 'x.com': ['twitter.com'], 'google.com': ['accounts.google.com', 'gmail.com'],
  'live.com': ['microsoftonline.com', 'outlook.com', 'microsoft.com'], 'jumia.com.ng': ['jumia.com'] };

const NAV = /\b(go|get|open|navigate|take me|bring me|visit|head|load|show me|launch)\b/i;
const LOGIN = /\b(log ?-?in|sign ?-?in|signin|login)\b/i;
const LOGIN_PAGE = /log ?-?in|sign ?-?in|signin|auth|session|account|password/i;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+(?:com|org|net|ng|io|dev|app|ai|co|edu|gov|uk|so|me|info|xyz)(?:\.[a-z]{2})?)\b/i;

const hostOf = (u) => { try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ''); } catch {
  return ''; } };
const sameSite = (host, want) => [want, ...(ALSO[want] || [])].some(w => host === w || host.endsWith(`.${w}`));

/** The site a goal wants the browser on: an explicit domain first, then a well-known name; '' when none. */
function targetHost(goal) {
  const g = String(goal || '');
  const d = g.match(DOMAIN);
  if (d) return d[1].toLowerCase().replace(/^www\./, '');
  const low = g.toLowerCase();
  const name = Object.keys(SITES).find(k => new RegExp(`\\b${k}\\b`).test(low));
  return name ? SITES[name] : '';
}

/** What a goal asks for: { nav, host, login }. nav = a "go to / open" goal (the finish must be on that page). */
function parseGoal(goal) {
  const g = String(goal || '');
  const host = targetHost(g);
  return { nav: NAV.test(g) && (Boolean(host) || /\b(page|site|website)\b/i.test(g)), host, login: LOGIN.test(g) };
}

/**
 * check({ goal, page: { url, title } | null, acted }) -> null when the finish may stand, else the reason (for Saga).
 *   acted: successful browser actions in THIS task (a continuation counts its own, not the earlier task's).
 */
function check({ goal, page, acted }) {
  const want = parseGoal(goal);
  const url = page && page.url ? String(page.url) : '';
  const title = page && page.title ? String(page.title) : '';
  const host = hostOf(url);
  const where = url ? `The browser is on ${url}${title ? ` ("${title.slice(0, 120)}")` : ''}.` : 'You have not '
    + 'opened or read any page in this task yet, so nothing confirms it.';
  if (want.host && (want.nav || !acted) && !sameSite(host, want.host)) {
    return `Not done yet: the task needs ${want.host}. ${where} Open it with openUrl (or navigate there), then check `
      + 'the page before you finish.';
  }
  if (want.nav && want.login && url && !LOGIN_PAGE.test(`${url} ${title}`)) {
    return `Not done yet: the task asks for a sign-in page. ${where} Open the sign-in page, then finish.`;
  }
  if (!acted && !url) return `Not done yet: ${where} Do the task in the browser (or call getPageContent to confirm `
    + 'the page) before you finish.';
  return null;
}

module.exports = { check, parseGoal, targetHost, hostOf, sameSite, MAX_REFUSALS };
