/* Colon JetX · the Android app's bridge (v0.34.0, Crash Predictor step 2).
   In the Colon JetX app this page runs in the bottom pane, under the user's own betting site, and the app gives it
   window.ColonJetX (apps/android: JetxBridge.kt, assets/jetx/bridge.js). It can ask the app to open the betting site
   in the top pane and hears the site's status: its host and whether it loaded, nothing more. The app never reads
   the site (game data comes in step 3) and never its passwords, cookies or tokens. In a normal browser there is no
   bridge, inApp() is false and the page works as before. */

function bridge() { var b = window.ColonJetX; return b && typeof b.call === 'function' ? b : null; }
function inApp() { return !!bridge(); }
function call(cmd, args) {
  var b = bridge();
  return b ? b.call(cmd, args || {}) : Promise.reject(new Error('Open this in the Colon JetX app.'));
}
// fn(data) for 'session' { status, host }, 'mode' { mode } and 'layout' { layout }; returns off().
function on(event, fn) { var b = bridge(); return b ? b.on(event, fn) : function () {}; }

// -> { app, version, mode, layout, session: { status, host }, autoClick: false }
function appStatus() { return call('status'); }
// Opens url (or the site the app already has) in the game pane.
function openSite(url) { return call('openSite', url ? { url: url } : {}); }

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

export { appStatus, describe, inApp, on, openSite };
