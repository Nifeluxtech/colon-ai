/* Colon AI · what the browser card in the thread shows around the page (0.11.2, owner: "polished like Hark Pro's
   live browser card"). The live card: a slim header (the site's icon and domain, a live status dot or spinner, a
   short task title, small icon buttons: full screen, Take control / Give back, Pause / Resume, Stop), the live page
   (the app's WebView over the card's body, nothing floating over it in the thread) and one status line under it
   (Saga's current step in plain words, one line). A finished run: a summary row (icon, domain, "Done · 5 steps")
   over its last picture; tapping it opens that run's steps. Pure and DOM-free: unit-tested in packages/ui/test/
   card-chrome.test.js; components/browser-card.js draws it. */

var LIVE = ['running', 'paused', 'needs_user', 'user_control'];
var TITLE_MAX = 60;

/** "https://www.jumia.com.ng/x" -> "jumia.com.ng"; '' when it isn't a web page. */
function domainOf(url) {
  var m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/** The site's own icon (never a third-party favicon service: only the site Saga is on learns about it). */
function faviconOf(url) {
  var m = /^(https:\/\/[^/?#]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() + '/favicon.ico' : '';
}

function clip(s, n) {
  var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
}

/** A short task title from the user's goal ("Search for yolotask earners"), capitalised, one line. */
function titleOf(goal) {
  var t = clip(goal, TITLE_MAX);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Saga’s browser';
}

/** The live status: working · waiting (Saga needs you) · paused · yours (you have the page) · done · error · idle. */
function statusOf(run) {
  var s = run && run.state;
  if (s === 'running') return 'working';
  if (s === 'needs_user') return 'waiting';
  if (s === 'paused') return 'paused';
  if (s === 'user_control') return 'yours';
  if (s === 'done') return 'done';
  if (s === 'error' || s === 'stopped') return 'error';
  return 'idle';
}

/**
 * The live card's chrome from the app's state (browser('state')): { domain, favicon, title, status, line,
 * controls }. controls, in order: expand · minimise, take · give, pause · resume, stop (only what applies now).
 */
function liveChrome(st) {
  st = st || {};
  var run = st.run || {}, pill = run.pill || {}, status = statusOf(run), live = LIVE.indexOf(run.state) >= 0;
  var controls = [st.focus ? 'minimise' : 'expand'];
  if (status === 'yours') controls.push('give');
  else if (status !== 'waiting') controls.push('take');
  if (status === 'working') controls.push('pause');
  if (status === 'paused') controls.push('resume');
  if (live) controls.push('stop');
  var line = String(pill.text || run.step || '').replace(/\s+/g, ' ').trim();
  if (!line) line = status === 'idle' ? 'Tell Saga what to do in this browser.' : '';
  return { domain: domainOf(st.url), favicon: faviconOf(st.url), title: titleOf(run.goal), status: status,
    line: line, controls: controls };
}

/** A finished run's summary row: { domain, favicon, text ("Done · 5 steps"), status }. */
function summaryOf(card) {
  var c = card || {}, n = Number(c.steps) || 0;
  var word = c.state === 'done' ? 'Done' : c.state === 'stopped' ? 'Stopped' : LIVE.indexOf(c.state) >= 0
    ? 'Working' : 'Couldn’t finish';
  var steps = n > 0 ? ' · ' + n + (n === 1 ? ' step' : ' steps') : '';
  return { domain: domainOf(c.url) || 'Saga’s browser', favicon: faviconOf(c.url), text: word + steps,
    status: c.state === 'done' ? 'done' : LIVE.indexOf(c.state) >= 0 ? 'working' : 'error',
    title: titleOf(c.goal), result: clip(c.result, 120) };
}

/** A run's steps (GET /browser/agent/:id actions) for its timeline sheet: [{ n, text, host, ok, approved }]. */
function stepsOf(actions) {
  return (actions || []).filter(function (a) { return a && (a.kind === 'action' || a.kind === 'extract'); })
    .map(function (a, i) { return { n: i + 1, text: clip(a.say || a.tool || 'Step', 140), host: domainOf(a.url),
      ok: a.ok !== false && a.ok !== 0, approved: a.approved || null }; });
}

export { domainOf, faviconOf, liveChrome, statusOf, stepsOf, summaryOf, titleOf };
