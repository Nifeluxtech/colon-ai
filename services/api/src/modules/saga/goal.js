// Goal check for Saga's finish (0.10.6). Saga used to be able to say "I have reached the GitHub login page" without
// opening anything: the finish was taken on its word. Now a finish is checked against where the browser really is
// (the URL and title of the last page this task saw, or the phone's page_state) before the task may end as done:
//   - a "go to / open X" goal that names a site needs the current URL's host to be that site;
//   - a goal that asks for a sign-in / login page needs the URL or title to look like one;
//   - a finish before any successful browser action in this task is refused when the page can't be confirmed.
// A refused finish goes back to Saga as an observation ("not done yet: the page is …"). After MAX_REFUSALS the
// finish is accepted, so a check that is wrong can never trap a task (the step limit still applies).
// 0.11.3 (owner: "Open the colon ai repository" ended after 1 step with "If you can see it, tap on it… otherwise I
// will try to find it now"): a finish that hands the user a click Saga could do, or only narrates what Saga is
// about to do, is refused; a "go to / open <name>" goal needs that name in the page's address or title, matched
// loosely on any site ("colon ai" = colon-ai = colon_ai = ColonAI; "infinix smart 20" = infinix-smart-20).
const MAX_REFUSALS = 3;

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

// Asking the user to do what Saga can, or a finish that only says what Saga is about to do.
const ASKS_USER = new RegExp('\\b(?:(?:you can|please|simply|just|kindly)\\s+(?:tap|click|press|open|select|scroll)|'
  + '(?:tap|click) on it|if you can see|let me know (?:if|when|which)|tell me (?:which|the exact|exactly)|'
  + '(?:could|can) you (?:tap|click|open|provide|tell me)|provide (?:me with )?the (?:full )?(?:url|link|name))', 'i');
const NARRATES = new RegExp("^\\s*(?:i am|i'm|i will|i'll|let me|i am going to|i'm going to)\\s+(?:now\\s+)?"
  + '(?:attempting|trying|try|going|navigate|navigating|look|looking|search|searching|check|checking|find|open)', 'i');
// Words around a name in "open the X repository / page / account named X": not part of what to match.
const FILLER = new Set(['the', 'a', 'an', 'my', 'our', 'your', 'his', 'her', 'their', 'this', 'that', 'to', 'in',
  'on', 'of', 'for', 'named', 'called', 'titled', 'page', 'site', 'website', 'account', 'profile', 'section', 'link',
  'tab', 'item', 'product', 'listing', 'post', 'repository', 'repo', 'project', 'folder', 'file', 'app', 'one']);
const NOT_A_NAME = new RegExp('\\b(?:first|second|third|last|next|previous|top|result|results|it|them|here|there|'
  + 'back|browser|home|homepage|dashboard|settings|login|sign|page \\d+)\\b', 'i');

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

/** 0.11.3: the thing a "go to / open X" goal names, letters and digits only ('colonai'); '' when it names none. */
function wantedName(goal) {
  const m = /\b(?:open|go to|goto|visit|navigate to|take me to|head to|bring up|show me)\s+([^().,;!?]{2,80})/i
    .exec(String(goal || ''));
  if (!m) return '';
  const part = m[1].split(/\s+(?:and|then|in|on|inside|from|at|so|to)\s+/i)[0].toLowerCase();
  if (NOT_A_NAME.test(part) || DOMAIN.test(part)) return '';
  const words = part.split(/\s+/).filter((w) => w && !FILLER.has(w) && !SITES[w]);
  if (!words.length || words.length > 5) return '';
  const name = words.join('').replace(/[^a-z0-9]/g, '');
  return name.length >= 3 ? name : '';
}
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// The address without its query (a search results page has the name in ?q=, and is not the page itself).
const SEARCHED = /[?&](?:q|query|search|search_query|k|s|keyword|term)=/i;
const pathOf = (u) => { try { const x = new URL(u); return decodeURIComponent(x.hostname + x.pathname); } catch {
  return String(u || ''); } };

/**
 * check({ goal, page: { url, title } | null, acted }) -> null when the finish may stand, else the reason (for Saga).
 *   acted: successful browser actions in THIS task (a continuation counts its own, not the earlier task's).
 */
function check({ goal, page, acted, answer = '' }) {
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
  if (ASKS_USER.test(answer) || NARRATES.test(answer)) {
    return 'Not done yet: do not ask the user to tap or click something you can do yourself, and do not finish with '
      + 'what you are about to do. Do it now: find it in the page\'s elements or links (getLinks), use the site\'s '
      + `search, or open its address with openUrl. ${where} Finish only with what the browser now shows.`;
  }
  const name = want.nav || NAV.test(String(goal || '')) ? wantedName(goal) : '';
  if (name && url && !squash(`${pathOf(url)} ${SEARCHED.test(url) ? '' : title}`)
    .includes(name)) {
    return `Not done yet: the task asks for "${name}", and the page is not it. ${where} Find the link whose text `
      + 'matches it loosely (ignore case, spaces, - and _) in the page\'s elements or getLinks and click it, use the '
      + 'site\'s search, or open the address directly (openUrl) when you can tell it from the page. Then check the '
      + 'page before you finish.';
  }
  return null;
}

/** 0.11.3: what a finish tells the user (its answer and result line, else its say), for check's answer. */
const said = (d) => `${(d.args && d.args.answer) || ''} ${(d.args && d.args.result) || ''}`.trim()
  || String(d.say || '');

module.exports = { said, check, parseGoal, targetHost, hostOf, sameSite, wantedName, MAX_REFUSALS };
