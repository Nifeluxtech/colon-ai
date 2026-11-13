/* Colon App core · the Android app shell (v0.8.0). Detects the Colon AI Android app (user-agent token
   "ColonAndroid/<version>" and window.ColonNative, docs/android-bridge.md) and wraps its bridge so screens can
   drive the native in-chat browser panel, save files, share and buzz without caring where they run. On the web
   every call resolves to a safe fallback, so callers never need two code paths. Since v0.8.0 there are two apps:
   Colon AI (colon-ai.apk, chat + in-chat browser) and Colon Browser (colon-browser.apk, the full browser). */

var UA_RE = /\bColonAndroid\/(\d+\.\d+\.\d+)/;
var RELEASES = 'https://github.com/Nifeluxtech/colon-ai/releases/latest';
var APK = RELEASES + '/download/colon-ai.apk';
var BROWSER_APK = RELEASES + '/download/colon-browser.apk';

/* Pure helpers (unit-tested in packages/ui/test/native.test.js). */
function shellVersion(ua) { var m = UA_RE.exec(ua || ''); return m ? m[1] : null; }
// "Get the Android app" is offered to Android phones in a normal browser, never inside the app itself.
function offerApp(ua, inShell) { return !inShell && /\bAndroid\b/i.test(ua || '') && !shellVersion(ua); }
// Where "Open in the app for full browsing" points: Android phones get Colon Browser's APK directly, everyone
// else the release page (which explains both apps).
function browserAppLink(ua) { return /\bAndroid\b/i.test(ua || '') ? BROWSER_APK : RELEASES; }
// Data URL -> just the base64 part, as the bridge's saveFile expects.
function base64Of(dataUrl) {
  var s = String(dataUrl || ''), i = s.indexOf('base64,');
  return i < 0 ? s : s.slice(i + 7);
}

// What a share from another app puts in the message box: the subject (when it adds something) and the text.
function shareText(p) {
  if (!p) return '';
  var text = String(p.text || '').trim(), subject = String(p.subject || '').trim();
  return (subject && text.indexOf(subject) < 0 ? subject + '\n' + text : text || subject).trim();
}
// { name, type, base64 } from the app -> a File the upload tray accepts (null when it can't be decoded).
function fileOf(f) {
  try {
    var bin = atob(f.base64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], f.name || 'shared-image', { type: f.type || 'application/octet-stream' });
  } catch (e) { return null; }
}

function nav() { return typeof navigator !== 'undefined' ? navigator.userAgent : ''; }
function bridge() { return typeof window !== 'undefined' ? window.ColonNative || null : null; }
function noNative() { var e = new Error('Not running in the Colon Android app.'); e.code = 'no_native';
  return Promise.reject(e); }

var native = {
  RELEASES: RELEASES, APK: APK, BROWSER_APK: BROWSER_APK, shellVersion: shellVersion, offerApp: offerApp,
  browserAppLink: browserAppLink, base64Of: base64Of, shareText: shareText, fileOf: fileOf,
  /** True inside the Colon AI Android app (even before the bridge script has run). */
  isShell: function () { return !!bridge() || !!shellVersion(nav()); },
  /** True once window.ColonNative is there (the bridge only exists on Colon's own pages). */
  hasBridge: function () { return !!bridge(); },
  version: function () { var b = bridge(); return (b && b.version) || shellVersion(nav()); },
  can: function (feature) { var b = bridge(); return !!(b && b.features && b.features.indexOf(feature) >= 0); },
  /** Resolves with the bridge when it is ready (at most `ms`), or null on the web. */
  ready: function (ms) {
    if (bridge()) return Promise.resolve(bridge());
    if (!shellVersion(nav()) || typeof window === 'undefined') return Promise.resolve(null);
    return new Promise(function (res) {
      var done = false, t = setTimeout(function () { finish(); }, ms || 4000);
      function finish() { if (done) return; done = true; clearTimeout(t);
        window.removeEventListener('colonnative:ready', finish); res(bridge()); }
      window.addEventListener('colonnative:ready', finish);
    });
  },
  call: function (cmd, args) { var b = bridge(); return b ? b.call(cmd, args) : noNative(); },
  on: function (ev, f) { var b = bridge(); return b ? b.on(ev, f) : function () {}; },
  /** Opens a link in the app's native browser panel. Returns false on the web (caller falls back). */
  openTab: function (url) { var b = bridge(); if (!b) return false; b.openTab(url || '').catch(function () {});
    return true; },
  /** True when the app has the native in-chat browser panel (Colon AI 0.8.0+). */
  hasPanel: function () { return native.can('browserPanel'); },
  /** Drives the native panel: action open|navigate|layout|collapse|close|back|forward|reload|handoff|state.
      Resolves with the panel state { open, layout, collapsed, url, title, loading, control, ... }. */
  browser: function (action, o) { var a = Object.assign({}, o || {}, { action: action });
    return native.hasPanel() ? native.call('browser', a) : noNative(); },
  haptic: function (kind) { var b = bridge(); if (b) b.haptic(kind || 'tap').catch(function () {}); },
  share: function (o) { var b = bridge(); if (b) return b.share(o);
    if (typeof navigator !== 'undefined' && navigator.share) return navigator.share(o); return noNative(); },
  /** Saves a Blob into the phone's Downloads through the app. Resolves false on the web. */
  saveBlob: function (blob, name) {
    var b = bridge(); if (!b || !b.features || b.features.indexOf('saveFile') < 0) return Promise.resolve(false);
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { b.call('saveFile', { name: name, mime: blob.type || '', base64: base64Of(fr.result) })
        .then(function () { res(true); }, rej); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  },
  /** Marks the page (html[data-shell="android"]) and keeps the app's system bars on the page theme. */
  init: function (theme) {
    if (!native.isShell() || typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-shell', 'android');
    native.ready().then(function (b) {
      if (!b) return;
      document.documentElement.setAttribute('data-native', 'ready');
      var sync = function (t) { b.setTheme(t || theme.current()).catch(function () {}); };
      sync(); theme.on(sync);
      b.setSession({}).catch(function () {}); // the bridge reconnects if sign-in changed the session
    });
  }
};

export { native };
