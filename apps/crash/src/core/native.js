/* Colon JetX · the Android app's bridge (v0.34.0, Crash Predictor step 2; collector v0.35.0, diagnostics v0.35.1+).
   In the Colon JetX app this page runs in the bottom pane, under the user's own betting site, and the app gives it
   window.ColonJetX (apps/android: JetxBridge.kt, assets/jetx/bridge.js). It can ask the app to open the betting site
   in the top pane and hears the site's status: its host and whether it loaded, nothing more. The app never reads
   the site's passwords, cookies or tokens. Since v0.35.0 its round collector reads JetX's finished multipliers in
   the game pane and sends them to the API itself; this page hears only its status ('collector' event) and can turn
   it on or off. In a normal browser there is no bridge, inApp() is false and the page works as before. */

function bridge() { var b = window.ColonJetX; return b && typeof b.call === 'function' ? b : null; }
function inApp() { return !!bridge(); }
function call(cmd, args) {
  var b = bridge();
  return b ? b.call(cmd, args || {}) : Promise.reject(new Error('Open this in the Colon JetX app.'));
}
// fn(data) for 'session' { status, host }, 'mode' { mode }, 'layout' { layout } and 'collector' { on, status,
// rounds_today, last_multiplier }; returns off().
function on(event, fn) { var b = bridge(); return b ? b.on(event, fn) : function () {}; }

// -> { app, version, mode, layout, session: { status, host }, autoClick: false, collector }
function appStatus() { return call('status'); }
// Opens url (or the site the app already has) in the game pane.
function openSite(url) { return call('openSite', url ? { url: url } : {}); }
// Turns the app's round collector on or off -> its status.
function setCollector(on) { return call('setCollector', { on: !!on }); }

var SITE = { none: 'No site open', loading: 'Loading…', loaded: 'Open', error: "Can't reach it", offline: 'Offline' };
var MODE = { manual: 'Manual', ai: 'AI (nothing is clicked for you yet)', shared: 'Shared (nothing is clicked yet)' };

// Plain-text parts of the app line: { tone: ''|'warn'|'bad', site, mode }.
function describe(st) {
  var s = (st && st.session) || {}, status = s.status || 'none';
  return {
    tone: status === 'loaded' ? '' : status === 'loading' ? 'warn' : 'bad',
    site: (SITE[status] || status) + (s.host && status === 'loaded' ? ' · ' + s.host : ''),
    mode: MODE[st && st.mode] || 'Manual'
  };
}

var COLLECTOR = { live: 'Collecting rounds', waiting: 'Waiting for JetX to finish a round',
  signed_out: 'Sign in to Colon here to save rounds', error: "Can't save rounds right now; retrying",
  unsupported: 'This phone’s WebView is too old to collect rounds', off: 'Off' };

// The collector's diagnostics (v0.35.1; v0.35.2 multiplier-like texts, canvases, shadow roots and samples) as one
// plain line: frames heard from, whether the history strip was found, what the frames hold and rounds sent today.
// '' when the app is older or the collector is off.
function collectorDetail(c) {
  if (!c || !c.on || c.frames_seen == null) return '';
  var strip = c.strip_found ? 'found (' + (c.strip_items || 0) + ' items)' : 'not found yet';
  var parts = ['Game frames seen: ' + (c.frames_seen || 0), 'History strip: ' + strip];
  if (c.mult_texts != null) parts.push('Multipliers on page: ' + (c.mult_texts || 0));
  if (c.canvases != null) parts.push('Canvases: ' + (c.canvases || 0));
  if (c.shadow_hosts) parts.push('Shadow roots: ' + c.shadow_hosts);
  if (c.closed_hint) parts.push('Closed components: ' + c.closed_hint);
  parts.push('Sent today: ' + (c.rounds_sent || 0));
  var sample = Array.isArray(c.sample) ? c.sample.filter(function (x) { return typeof x === 'string'; }) : [];
  if (sample.length) parts.push('Sample: ' + sample.slice(0, 3).join(', '));
  if (c.last_error) parts.push('Last error: ' + c.last_error);
  return parts.join(' · ');
}

// The app's collector line: { tone, text, on, detail }.
function describeCollector(c) {
  var st = (c && c.status) || 'off';
  return { on: !!(c && c.on), text: COLLECTOR[st] || st, detail: collectorDetail(c),
    tone: st === 'live' ? '' : st === 'waiting' ? 'warn' : 'bad' };
}

export { appStatus, collectorDetail, describe, describeCollector, inApp, on, openSite, setCollector };
