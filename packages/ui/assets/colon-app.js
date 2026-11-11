/* Colon App core: API client, router with smooth transitions, UI helpers, and the
   shared account screens (sign in, sign up, reset, verify, 2FA, sessions, profile).
   Used by every Colon web app: Colon.start({ app, title, nav, routes, home }). */
(function () {
  'use strict';
  // API base. Override for local development with window.COLON_API = 'http://localhost:3000' before this script.
  var API = (typeof window !== 'undefined' && window.COLON_API) || 'https://api.apparatus.name.ng';
  var LANGS = { en: 'English', pcm: 'Naijá (Pidgin)', yo: 'Yorùbá', ha: 'Hausa', ig: 'Igbo' };
  var state = { user: null, config: null, app: null, mounted: null };

  /* ---------- Theme (dark default · light · system), applied before first paint ---------- */
  var theme = (function () {
    var KEY = 'colon.theme', mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null, subs = [];
    function pref() { try { return localStorage.getItem(KEY) || 'dark'; } catch (e) { return 'dark'; } }
    function resolved(p) { p = p || pref(); return p === 'system' ? (mq && mq.matches ? 'light' : 'dark') : p; }
    function apply() {
      var t = resolved(); document.documentElement.setAttribute('data-theme', t);
      var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#FFFFFF' : '#080F24');
      subs.forEach(function (f) { f(t); });
    }
    function set(p) { try { localStorage.setItem(KEY, p); } catch (e) {} apply(); }
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (pref() === 'system') apply(); });
    apply();
    return { get: pref, current: function () { return resolved(); }, set: set, toggle: function () { set(resolved() === 'dark' ? 'light' : 'dark'); }, on: function (f) { subs.push(f); } };
  })();

  /* ---------- Icons (inline SVG, stroke = currentColor) ---------- */
  var P = {
    flame: '<path d="M12 2c2.5 3.2 4.5 5.6 4.5 9a4.5 4.5 0 0 1-9 0c0-1.6.6-3 1.6-4.2.2 1.3.9 2.2 1.9 2.7C10.6 7.6 11 4.8 12 2z"/><path d="M12 21a7 7 0 0 0 7-7"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
    devices: '<rect x="2" y="5" width="14" height="10" rx="2"/><rect x="17" y="8" width="5" height="11" rx="1.5"/><path d="M6 19h6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>',
    out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    book: '<path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
    sparkles: '<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6L10 3z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/>',
    fileText: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    micOff: '<path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.2 5.6M19 11c0 .8-.1 1.5-.4 2.2M12 18v3"/>',
    clip: '<path d="M20.5 11.5l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7L9.7 17.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
    play: '<path d="M7 5l12 7-12 7V5z"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9M4 13a8 8 0 0 0 14.6 4.5L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>',
    thumbUp: '<path d="M7 11v9H4v-9h3zM7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.3 20H7"/>',
    thumbDown: '<path d="M17 13V4h3v9h-3zM17 13l-4 8a2.5 2.5 0 0 1-2.5-2.5V15H5.3a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 6.7 4H17"/>',
    pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z"/><path d="M12 14v7"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    moreV: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4V3z"/>',
    bookmarkFill: '<path d="M6 3h12v18l-6-4-6 4V3z" fill="currentColor"/>',
    saved: '<path d="M6 3h12v18l-6-4-6 4V3z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    tabs: '<rect x="3" y="6" width="14" height="14" rx="2.5"/><path d="M7 6V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/>',
    maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    minimize: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 14h18"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    collapse: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.8 15a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    explore: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
    wifiOff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.5M12 20h.01M19 13a10 10 0 0 0-2.2-1.6M2 9.5a15 15 0 0 1 4.4-2.8M10.7 5.1A15 15 0 0 1 22 9.5"/>',
    lightning: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4L4 5z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    reader: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
    cursor: '<path d="M5 3l14 8-6 2-2 6-6-16z"/>',
    language: '<path d="M4 5h9M8.5 3v2c0 4-2.5 7-5 8.5M6 9c1 2.5 3.5 4.5 6.5 5.5"/><path d="M13 21l4-9 4 9M14.5 18h5"/>',
    volume: '<path d="M4 9h4l5-4v14l-5-4H4V9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.7-.9 1.4-1.9-.4-1.2.3-2.1 1.6-2.1H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>'
  };
  function icon(n, cls) { return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || '') + '</svg>'; }
  // Colon flame mark: royal-blue outer flame with a warm core (matches the brand mockup).
  // Colon flame mark: royal-blue outer flame with a warm core (matches the brand mockup).
  // Gradients live once in a shared <defs> block (duplicate ids inside hidden copies break in Chrome).
  var MARK_DEFS = '<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="cm-o" x1="10" y1="44" x2="38" y2="4" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3457C7"/><stop offset=".55" stop-color="#4169E1"/><stop offset="1" stop-color="#38BDF8"/></linearGradient>' +
    '<linearGradient id="cm-i" x1="24" y1="42" x2="24" y2="18" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FF6A1A"/><stop offset=".6" stop-color="#FF9A3D"/><stop offset="1" stop-color="#FFD166"/></linearGradient></defs></svg>';
  function injectDefs() { if (!document.getElementById('colon-mark-defs')) { var d = document.createElement('div'); d.id = 'colon-mark-defs'; d.innerHTML = MARK_DEFS; document.body.insertBefore(d, document.body.firstChild); } }
  if (document.body) injectDefs(); else document.addEventListener('DOMContentLoaded', injectDefs);
  var MARK = '<svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="url(#cm-o)" d="M24 2c5.6 6.8 12.6 12.4 12.6 22.4A12.6 12.6 0 0 1 24 37a12.6 12.6 0 0 1-12.6-12.6c0-4.6 1.8-8.4 4.8-11.6.4 3.6 2.2 6 5 7.2C20.6 13.6 21.4 7.4 24 2z"/>' +
    '<path fill="url(#cm-i)" d="M24 18.5c2.6 3.4 5.6 6 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-2.1.8-3.8 2.2-5.2.2 1.6 1 2.7 2.2 3.2-.3-3.3.1-5.9 1.2-8.4z"/>' +
    '<ellipse cx="24" cy="43" rx="9" ry="2.2" fill="#38BDF8" opacity=".35"/></svg>';
  function logo(name, sub, cls) { return '<span class="logo ' + (cls || '') + '">' + MARK + '<span><b>' + esc(name || 'COLON AI') + '</b>' + (sub === false ? '' : '<small>' + esc(sub || 'by Nifelux') + '</small>') + '</span></span>'; }

  /* ---------- Helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function initials(name, email) { var s = (name || email || '?').trim(); var p = s.split(/\s+/); return ((p[0] || '')[0] + ((p[1] || '')[0] || '')).toUpperCase(); }
  function ago(d) {
    var s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 604800) return Math.floor(s / 86400) + ' d ago';
    return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function device(ua) {
    ua = ua || '';
    var os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown device';
    var br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return br + ' on ' + os;
  }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    if (opts.raw) {  // streaming callers (SSE) get the Response itself
      var h = { 'X-Colon-Client': state.app || 'web' }; if (opts.body !== undefined) h['Content-Type'] = 'application/json';
      return fetch(API + path, { method: opts.method || 'GET', credentials: 'include', headers: h, signal: opts.signal, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    }
    var init = { method: opts.method || 'GET', credentials: 'include', headers: { 'X-Colon-Client': state.app || 'web' } };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.message || 'Something went wrong.'); e.status = r.status; e.code = data.error; e.field = data.field; throw e; }
        return data;
      });
    }, function () { var e = new Error("Can't reach Colon right now. Check your connection."); e.code = 'offline'; throw e; });
  }

  /* ---------- Toast, sheet/modal, confirm, prompt ---------- */
  // toast(message, kind?: 'ok'|'bad', action?: { label, fn })
  function toast(msg, kind, action) {
    var host = $('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
    host.setAttribute('aria-live', 'polite');
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    var span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
    if (action) {
      var b = document.createElement('button'); b.className = 'toast-act'; b.type = 'button'; b.textContent = action.label;
      b.addEventListener('click', function () { action.fn(); t.remove(); }); t.appendChild(b);
    }
    host.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 260); }, action ? 6000 : 3400);
  }
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function trapFocus(el, e) {
    if (e.key !== 'Tab') return;
    var f = $$(FOCUSABLE, el).filter(function (x) { return x.offsetParent !== null; }); if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  // sheet(html, onMount?, opts?: { cls, label, onClose }) -> close()
  function sheet(html, onMount, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var back = document.createElement('div'); back.className = 'sheet-back';
    var el = document.createElement('div'); el.className = 'sheet ' + (opts.cls || ''); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    if (opts.label) el.setAttribute('aria-label', opts.label);
    el.innerHTML = html;
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      back.remove(); el.remove(); document.removeEventListener('keydown', onKey, true);
      if (prev && prev.focus) try { prev.focus(); } catch (e) {}
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } else trapFocus(el, e); }
    back.addEventListener('click', close); document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back); document.body.appendChild(el);
    $$('[data-close]', el).forEach(function (b) { b.addEventListener('click', close); });
    if (onMount) onMount(el, close);
    var f = $('[autofocus]', el) || $('input,textarea,select', el) || $('button', el); if (f) setTimeout(function () { f.focus(); }, 50);
    return close;
  }
  // confirm({ title, body, confirm, cancel, danger }) -> Promise<boolean>
  function confirmDialog(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var done = false;
      sheet('<div class="h2">' + esc(o.title || 'Are you sure?') + '</div>' + (o.body ? '<p class="small muted" style="margin:6px 0 0">' + esc(o.body) + '</p>' : '') +
        '<div class="sheet-actions"><button type="button" class="btn ghost" data-close>' + esc(o.cancel || 'Cancel') + '</button>' +
        '<button type="button" class="btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok autofocus>' + esc(o.confirm || 'Confirm') + '</button></div>',
        function (el, close) { $('[data-ok]', el).addEventListener('click', function () { done = true; close(); resolve(true); }); },
        { label: o.title, onClose: function () { if (!done) resolve(false); } });
    });
  }
  // prompt({ title, label, value, placeholder, confirm, max }) -> Promise<string|null>
  function promptDialog(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var done = false;
      sheet('<div class="h2">' + esc(o.title || '') + '</div><form class="form" style="margin-top:14px" novalidate>' +
        '<div class="field"><label for="pd-in">' + esc(o.label || '') + '</label><input class="input" id="pd-in" maxlength="' + (o.max || 120) + '" value="' + esc(o.value || '') + '" placeholder="' + esc(o.placeholder || '') + '" autofocus><div class="msg"></div></div>' +
        '<div class="sheet-actions" style="margin-top:4px"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">' + esc(o.confirm || 'Save') + '</button></div></form>',
        function (el, close) {
          var inp = $('input', el); setTimeout(function () { inp.select(); }, 60);
          $('form', el).addEventListener('submit', function (e) {
            e.preventDefault(); var v = inp.value.trim();
            if (!v && o.required !== false) { inp.parentNode.classList.add('err'); $('.msg', el).textContent = 'This can’t be empty.'; return; }
            done = true; close(); resolve(v);
          });
        }, { label: o.title, onClose: function () { if (!done) resolve(null); } });
    });
  }

  /* ---------- Popover menu: menu(anchor, items, opts) ----------
     items: [{ label, sub?, icon?, onClick, danger?, checked?, disabled? } | '-' | { head }] */
  var openMenu = null;
  function menu(anchor, items, opts) {
    opts = opts || {};
    if (openMenu) { var same = openMenu.anchor === anchor; openMenu.close(); if (same) return; }
    var el = document.createElement('div'); el.className = 'menu' + (opts.sheetOnMobile ? ' as-sheet' : ''); el.setAttribute('role', 'menu');
    if (opts.label) el.setAttribute('aria-label', opts.label);
    el.innerHTML = items.map(function (it, i) {
      if (it === '-') return '<hr>';
      if (it.head) return '<div class="menu-head">' + esc(it.head) + '</div>';
      if (it.html) return it.html;
      var role = it.checked !== undefined ? 'menuitemradio' : 'menuitem';
      return '<button type="button" class="mi' + (it.danger ? ' danger' : '') + '" role="' + role + '" data-i="' + i + '"' + (it.checked !== undefined ? ' aria-checked="' + !!it.checked + '"' : '') + (it.disabled ? ' disabled' : '') + '>' +
        (it.icon ? icon(it.icon) : '') + '<span class="mi-body">' + esc(it.label) + (it.sub ? '<span class="mi-sub">' + esc(it.sub) + '</span>' : '') + '</span>' +
        (it.badge ? it.badge : '') + (it.checked ? '<span class="tick">' + icon('check') + '</span>' : '') + '</button>';
    }).join('');
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    var left = opts.align === 'right' ? r.right - w : r.left; left = Math.max(8, Math.min(left, innerWidth - w - 8));
    var top = r.bottom + 6; if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    function close() {
      el.remove(); anchor.setAttribute('aria-expanded', 'false'); openMenu = null;
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); removeEventListener('resize', close);
    }
    function outside(e) { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); }
    function key(e) {
      var btns = $$('.mi:not([disabled])', el), i = btns.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
      else if (e.key === 'Tab') close();
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.mi'); if (!b) return;
      var it = items[Number(b.getAttribute('data-i'))]; close(); if (it && it.onClick) it.onClick();
    });
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
    document.addEventListener('keydown', key, true); addEventListener('resize', close);
    var first = $('.mi[aria-checked="true"]', el) || $('.mi:not([disabled])', el); if (first) first.focus({ preventScroll: true });
    openMenu = { anchor: anchor, close: close, el: el };
    return close;
  }

  /* ---------- Tooltips: any element with data-tip="…" (hover / keyboard focus) ---------- */
  (function () {
    var tip = null, timer = null;
    function hide() { clearTimeout(timer); if (tip) { tip.remove(); tip = null; } }
    function show(t) {
      hide(); var text = t.getAttribute('data-tip'); if (!text) return;
      timer = setTimeout(function () {
        tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = text; document.body.appendChild(tip);
        var r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
        var top = r.top - h - 8; if (top < 6) top = r.bottom + 8;
        tip.style.left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6)) + 'px'; tip.style.top = top + 'px';
      }, 350);
    }
    document.addEventListener('pointerover', function (e) { if (e.pointerType === 'touch') return; var t = e.target.closest && e.target.closest('[data-tip]'); if (t) show(t); });
    document.addEventListener('pointerout', function (e) { if (e.target.closest && e.target.closest('[data-tip]')) hide(); });
    document.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t && t.matches(':focus-visible')) show(t); else hide(); });
    document.addEventListener('pointerdown', hide, true); document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  })();

  /* ---------- Drawer: drawer(el) -> { open, close, toggle, isOpen } ---------- */
  function drawer(el, opts) {
    opts = opts || {};
    var back = document.createElement('div'); back.className = 'drawer-back'; el.parentNode.insertBefore(back, el);
    var prev = null, open = false;
    function key(e) { if (e.key === 'Escape') ctl.close(); else trapFocus(el, e); }
    var ctl = {
      open: function () { if (open) return; open = true; prev = document.activeElement; el.classList.add('open'); back.classList.add('open'); el.removeAttribute('inert'); el.setAttribute('aria-hidden', 'false');
        document.addEventListener('keydown', key, true); var f = $(FOCUSABLE, el); if (f) setTimeout(function () { f.focus(); }, 60); if (opts.onChange) opts.onChange(true); },
      close: function () { if (!open) return; open = false; el.classList.remove('open'); back.classList.remove('open'); el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', key, true); if (prev && prev.focus) prev.focus(); if (opts.onChange) opts.onChange(false); },
      toggle: function () { open ? ctl.close() : ctl.open(); },
      isOpen: function () { return open; },
      destroy: function () { document.removeEventListener('keydown', key, true); back.remove(); }
    };
    back.addEventListener('click', ctl.close);
    el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true');
    return ctl;
  }

  /* ---------- Mobile keyboard: --kb = on-screen keyboard height (visualViewport) ---------- */
  var kbBound = false;
  function keyboard() {
    if (kbBound || !window.visualViewport) return; kbBound = true;
    var vv = window.visualViewport;
    function upd() {
      var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb', (kb > 60 ? kb : 0) + 'px');
      document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');  // visible height above the keyboard
      document.documentElement.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
      document.documentElement.classList.toggle('kb-open', kb > 60);
    }
    vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd); upd();
  }

  /* ---------- Resizable split: resizable(handle, { min, max, get, set, axis }) ---------- */
  function resizable(handle, o) {
    var start = 0, startVal = 0, axis = o.axis || 'x';
    handle.setAttribute('role', 'separator'); handle.setAttribute('tabindex', '0'); handle.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
    function clamp(v) { return Math.max(o.min, Math.min(o.max(), v)); }
    function aria() { handle.setAttribute('aria-valuenow', Math.round(o.get())); handle.setAttribute('aria-valuemin', o.min); handle.setAttribute('aria-valuemax', Math.round(o.max())); }
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('dragging');
      start = axis === 'x' ? e.clientX : e.clientY; startVal = o.get(); document.body.style.userSelect = 'none';
    });
    handle.addEventListener('pointermove', function (e) {
      if (!handle.classList.contains('dragging')) return;
      var d = (axis === 'x' ? e.clientX : e.clientY) - start; o.set(clamp(startVal + (o.invert ? -d : d))); aria();
    });
    function end() { handle.classList.remove('dragging'); document.body.style.userSelect = ''; if (o.done) o.done(o.get()); }
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    handle.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 60 : 20, dir = 0;
      if (e.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp')) dir = -1; else if (e.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown')) dir = 1; else return;
      e.preventDefault(); o.set(clamp(o.get() + dir * step * (o.invert ? -1 : 1))); aria(); if (o.done) o.done(o.get());
    });
    aria();
  }

  /* ---------- Misc helpers ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); } ta.remove();
    });
  }
  function fmtBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
  function uid(prefix) { return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  /* ---------- Forms ---------- */
  function field(o) {
    var id = 'f-' + o.name, type = o.type || 'text';
    var input = type === 'select'
      ? '<select class="select" id="' + id + '" name="' + o.name + '">' + o.options.map(function (op) { return '<option value="' + op[0] + '"' + (op[0] === o.value ? ' selected' : '') + '>' + esc(op[1]) + '</option>'; }).join('') + '</select>'
      : '<input class="input' + (o.cls ? ' ' + o.cls : '') + '" id="' + id + '" name="' + o.name + '" type="' + type + '"' +
        (o.value != null ? ' value="' + esc(o.value) + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.auto ? ' autocomplete="' + o.auto + '"' : '') + (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.required === false ? '' : ' required') + '>';
    if (type === 'password') input = '<div class="pw-wrap">' + input + '<button type="button" class="icon-btn" data-pw aria-label="Show password">' + icon('eye') + '</button></div>';
    return '<div class="field" data-field="' + o.name + '"><label for="' + id + '">' + esc(o.label) + '</label>' + input + (o.meter ? '<div class="meter"><i></i></div>' : '') + '<div class="msg"></div></div>';
  }
  function bindForm(form, submit) {
    $$('[data-pw]', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var i = b.previousElementSibling, show = i.type === 'password';
        i.type = show ? 'text' : 'password'; b.innerHTML = icon(show ? 'eyeoff' : 'eye'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
    $$('.meter', form).forEach(function (m) {
      var i = $('input', m.parentNode);
      i.addEventListener('input', function () {
        var v = i.value, s = 0; if (v.length >= 10) s++; if (v.length >= 14) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
        var bar = $('i', m); bar.style.width = (s * 20) + '%'; bar.style.background = s < 3 ? 'var(--bad)' : s < 4 ? 'var(--warn)' : 'var(--ok)';
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('.field', form).forEach(function (f) { f.classList.remove('err'); $('.msg', f).textContent = ''; });
      var btn = $('button[type=submit]', form), label = btn.innerHTML;
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() === v ? v : (k.indexOf('password') > -1 ? v : v.trim()) : v; });
      $$('input[type=checkbox]', form).forEach(function (c) { data[c.name] = c.checked; });
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      Promise.resolve().then(function () { return submit(data); }).catch(function (err) {
        var f = err.field && $('[data-field="' + err.field + '"]', form);
        if (f) { f.classList.add('err'); $('.msg', f).textContent = err.message; var inp = $('input', f); if (inp) inp.focus(); }
        else toast(err.message, 'bad');
      }).then(function () { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = label; } });
    });
  }

  /* ---------- Router (hash-based, smooth transitions, scroll memory) ---------- */
  var routes = [], scrolls = {}, current = null;
  function parse() {
    var h = location.hash.replace(/^#/, '') || '/';
    var q = h.indexOf('?'), path = q > -1 ? h.slice(0, q) : h;
    return { path: path, query: new URLSearchParams(q > -1 ? h.slice(q + 1) : '') };
  }
  function go(path, replace) {
    if (replace) { history.replaceState(null, '', '#' + path); render(); }
    else location.hash = path;
  }
  function findRoute(path) {
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].re); if (m) return { r: routes[i], params: m.slice(1) };
    }
    return null;
  }
  function render() {
    var loc = parse(), found = findRoute(loc.path) || findRoute('/');
    var r = found.r;
    if (r.auth === true && !state.user) return go('/login?next=' + encodeURIComponent(loc.path), true);
    if (r.auth === 'guest' && state.user) return go(loc.query.get('next') || '/', true);
    if (r.role && !hasRole(r.role)) return go('/', true);
    if (current) scrolls[current] = window.scrollY;
    current = loc.path;
    // App-style routes sharing one `app` key stay mounted; only update() runs (no flash, state kept).
    if (r.app && state.mounted === r.app && r.update && $('#app .view')) {
      document.title = (r.title ? r.title + ' · ' : '') + (state.title || 'Colon AI');
      r.update($('#app .view'), { params: found.params, query: loc.query, path: loc.path }); return;
    }
    if (state.unmount) { try { state.unmount(); } catch (e) {} state.unmount = null; }
    state.mounted = r.app || null;
    var swap = function () {
      var root = $('#app');
      root.innerHTML = r.bare ? '<div class="view' + (r.app ? ' app-view' : '') + '">' + '</div>' : shell(r, loc);
      var view = r.bare ? $('.view', root) : $('#view', root);
      document.title = (r.title ? r.title + ' · ' : '') + (state.title || 'Colon AI');
      try { var un = r.render(view, { params: found.params, query: loc.query, path: loc.path }); if (typeof un === 'function') state.unmount = un; }
      catch (e) { view.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
      window.scrollTo(0, scrolls[loc.path] || 0);
      var h = $('h1, .h1', view); if (h && !r.bare) h.setAttribute('tabindex', '-1');
    };
    if (!r.app && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
    else swap();
  }

  var RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };
  function hasRole(role) { return state.user && RANK[state.user.role] >= RANK[role]; }
  function roleName(r) { return { user: 'Member', moderator: 'Moderator', admin: 'Admin', super_admin: 'Super Admin' }[r] || r; }

  function shell(r, loc) {
    var nav = state.nav.filter(function (n) { return !n.role || hasRole(n.role); });
    var active = function (n) { return n.match ? n.match.test(loc.path) : loc.path === n.href; };
    var links = function (cls) { return nav.map(function (n) { return '<a href="#' + n.href + '" class="' + (active(n) ? 'active' : '') + '"' + (active(n) ? ' aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + esc(n.label) + '</span></a>'; }).join(''); };
    var brand = '<a class="brand" href="#/" aria-label="' + esc(state.title) + ' home">' + logo(state.brand, state.subtitle) + '</a>';
    var back = r.back ? '<a class="icon-btn" href="#' + r.back + '" aria-label="Back">' + icon('back') + '</a>' : '';
    return '<div class="app has-nav">' +
      '<aside class="sidebar">' + brand + '<nav>' + links() + '</nav><div class="foot small muted">Colon AI by Nifelux</div></aside>' +
      '<header class="topbar">' + (back || brand) + '<h1>' + (back ? esc(r.title || '') : '') + '</h1>' + (r.action ? r.action() : '') + '</header>' +
      '<main class="main' + (r.wide ? ' wide' : '') + (r.composer ? ' with-composer' : '') + '"><div id="view" class="view"></div></main>' +
      '<nav class="tabbar" aria-label="Main">' + links() + '</nav></div>';
  }

  /* ---------- Shared account screens ---------- */
  function authPage(view, title, lead, body) {
    view.innerHTML = '<div class="auth"><div class="inner"><div class="brand">' + logo(state.brand, 'by Nifelux', 'lg') + '</div>' +
      '<h1 class="h1">' + title + '</h1><p class="lead">' + lead + '</p>' + body + '</div>' +
      '<div class="legal">Colon AI by Nifelux · <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a></div></div>';
  }
  function afterAuth(q) {
    return refreshUser().then(function () { go((q && q.get('next')) || '/', true); });
  }
  function googleButton(view, q, onTotp) {
    var cid = state.config && state.config.google_client_id; if (!cid) return;
    var slot = $('#g-slot', view); if (!slot) return;
    slot.innerHTML = '<div class="divider">or</div><div id="g-btn" style="display:flex;justify-content:center;min-height:44px"></div>';
    var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: cid, callback: function (resp) {
        api('/auth/google', { method: 'POST', body: { credential: resp.credential } }).then(function (d) {
          if (d.need_totp) return onTotp(function (code) { return api('/auth/google', { method: 'POST', body: { credential: resp.credential, code: code } }); });
          return afterAuth(q);
        }).catch(function (e) { toast(e.message, 'bad'); });
      } });
      google.accounts.id.renderButton($('#g-btn'), { theme: 'filled_black', size: 'large', shape: 'pill', width: Math.min(380, view.clientWidth - 40), text: 'continue_with' });
    };
    document.head.appendChild(s);
  }
  function totpStep(view, q, submitCode) {
    authPage(view, 'Two-step check', 'Enter the 6-digit code from your authenticator app.',
      '<form class="form" novalidate>' + field({ name: 'code', label: 'Authentication code', mode: 'numeric', auto: 'one-time-code', max: 6, cls: 'code-input', placeholder: '••••••' }) +
      '<button class="btn primary block" type="submit">Verify</button></form><p class="alt"><a href="#/login">Use a different account</a></p>');
    bindForm($('form', view), function (d) { return submitCode(d.code).then(function () { return afterAuth(q); }); });
  }

  var authRoutes = [
    { path: '/login', auth: 'guest', bare: true, title: 'Sign in', render: function (view, ctx) {
      authPage(view, 'Welcome back', 'Sign in to continue to ' + esc(state.title) + '.',
        '<form class="form" novalidate>' +
        field({ name: 'email', label: 'Email', type: 'email', auto: 'email', mode: 'email', placeholder: 'you@example.com' }) +
        field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) +
        '<div style="text-align:right;margin-top:-4px"><a class="link small" href="#/forgot">Forgot password?</a></div>' +
        '<button class="btn primary block" type="submit">Sign in</button></form><div id="g-slot"></div>' +
        (state.allowSignup ? '<p class="alt">New to Colon? <a href="#/register' + (ctx.query.get('next') ? '?next=' + encodeURIComponent(ctx.query.get('next')) : '') + '">Create an account</a></p>' : ''));
      var withTotp = function (fn) { totpStep(view, ctx.query, fn); };
      bindForm($('form', view), function (d) {
        return api('/auth/login', { method: 'POST', body: d }).then(function (r) {
          if (r.need_totp) return withTotp(function (code) { return api('/auth/login', { method: 'POST', body: { email: d.email, password: d.password, code: code } }); });
          return afterAuth(ctx.query);
        });
      });
      googleButton(view, ctx.query, withTotp);
    } },
    { path: '/register', auth: 'guest', bare: true, title: 'Create account', render: function (view, ctx) {
      if (!state.allowSignup) return go('/login', true);
      authPage(view, 'Create your account', 'Free to start. Built for Africa.',
        '<form class="form" novalidate>' +
        field({ name: 'name', label: 'Your name', auto: 'name', max: 80, placeholder: 'Ada Okafor' }) +
        field({ name: 'email', label: 'Email', type: 'email', auto: 'email', mode: 'email', placeholder: 'you@example.com' }) +
        field({ name: 'password', label: 'Password', type: 'password', auto: 'new-password', meter: true, placeholder: 'At least 10 characters' }) +
        field({ name: 'language', label: 'Preferred language', type: 'select', value: 'en', options: Object.keys(LANGS).map(function (k) { return [k, LANGS[k]]; }) }) +
        '<div class="field" data-field="accept_terms"><label class="check"><input type="checkbox" name="accept_terms"> <span>I agree to the <a class="link" href="#/terms">Terms</a> and <a class="link" href="#/privacy">Privacy Policy</a>.</span></label><div class="msg"></div></div>' +
        '<button class="btn primary block" type="submit">Create account</button></form><div id="g-slot"></div>' +
        '<p class="alt">Already have an account? <a href="#/login">Sign in</a></p>');
      bindForm($('form', view), function (d) {
        return api('/auth/register', { method: 'POST', body: d }).then(function (r) {
          toast(r.verification_sent ? 'Account created. Check your email to confirm it.' : 'Account created. Welcome to Colon!', 'ok');
          return afterAuth(ctx.query);
        });
      });
      googleButton(view, ctx.query, function (fn) { totpStep(view, ctx.query, fn); });
    } },
    { path: '/forgot', bare: true, title: 'Reset password', render: function (view) {
      authPage(view, 'Reset your password', "Enter your email and we'll send you a reset link.",
        '<form class="form" novalidate>' + field({ name: 'email', label: 'Email', type: 'email', auto: 'email', mode: 'email' }) +
        '<button class="btn primary block" type="submit">Send reset link</button></form><p class="alt"><a href="#/login">Back to sign in</a></p>');
      bindForm($('form', view), function (d) {
        return api('/auth/forgot', { method: 'POST', body: d }).then(function () {
          authPage(view, 'Check your email', 'If an account exists for ' + esc(d.email) + ', a reset link is on its way. It works for 1 hour.', '<a class="btn block" href="#/login">Back to sign in</a>');
        });
      });
    } },
    { path: '/reset', bare: true, title: 'New password', render: function (view, ctx) {
      authPage(view, 'Choose a new password', "You'll be signed out on all devices.",
        '<form class="form" novalidate>' + field({ name: 'password', label: 'New password', type: 'password', auto: 'new-password', meter: true }) +
        '<button class="btn primary block" type="submit">Save password</button></form>');
      bindForm($('form', view), function (d) {
        return api('/auth/reset', { method: 'POST', body: { token: ctx.query.get('token'), password: d.password } }).then(function () {
          toast('Password updated. Please sign in.', 'ok'); state.user = null; go('/login', true);
        });
      });
    } },
    { path: '/verify', bare: true, title: 'Confirm email', render: function (view, ctx) {
      authPage(view, 'Confirming…', 'One moment.', '<div class="skel" style="height:50px"></div>');
      api('/auth/verify-email', { method: 'POST', body: { token: ctx.query.get('token') } }).then(function () {
        return refreshUser().then(function () { authPage(view, 'Email confirmed', 'Thanks! Your account is fully set up.', '<a class="btn primary block" href="#/">Continue</a>'); });
      }).catch(function (e) { authPage(view, 'Link not valid', esc(e.message), '<a class="btn block" href="#/account">Go to account</a>'); });
    } },
    { path: '/terms', bare: true, title: 'Terms', render: function (view) { legal(view, 'Terms of Service', TERMS); } },
    { path: '/privacy', bare: true, title: 'Privacy', render: function (view) { legal(view, 'Privacy Policy', PRIVACY); } },

    { path: '/account', auth: true, title: 'Account', render: accountHome },
    { path: '/account/profile', auth: true, title: 'Profile', back: '/account', render: profilePage },
    { path: '/account/security', auth: true, title: 'Security', back: '/account', render: securityPage },
    { path: '/account/sessions', auth: true, title: 'Devices', back: '/account', render: sessionsPage }
  ];

  var TERMS = '<p><b>Draft, November 2026.</b> These terms will be finalised before public launch (Roadmap Phase 11).</p><p>Colon AI is provided by Nifelux. Use it lawfully and respectfully. Do not use Colon to harm others, break the law, or attack the service. AI answers can be wrong: check important information, especially medical, legal and financial matters.</p><p>You can delete your account at any time from Account → Security.</p>';
  var PRIVACY = '<p><b>Draft, November 2026.</b> This policy will be finalised for NDPR/NDPA compliance before public launch.</p><p>We store your name, email, language choice, sign-in sessions (device and IP) and security logs to run and protect your account. Passwords are stored as one-way hashes. We never sell your data.</p><p>Deleting your account removes your profile and sign-in sessions immediately. Security logs are kept for a limited time to protect the service.</p>';
  function legal(view, title, html) {
    view.innerHTML = '<div class="auth"><div class="inner" style="max-width:640px"><a class="btn ghost sm" href="javascript:history.back()">' + icon('back') + ' Back</a><h1 class="h1" style="text-align:left;margin-top:16px">' + title + '</h1><div class="card" style="color:var(--text-2);line-height:1.7">' + html + '</div></div></div>';
  }

  function verifyBanner() {
    if (!state.user || state.user.email_verified) return '';
    return '<div class="banner">' + icon('mail') + '<span>Confirm your email to secure your account.</span><button class="btn sm" data-resend>Resend</button></div>';
  }
  function bindBanner(view) {
    var b = $('[data-resend]', view); if (!b) return;
    b.addEventListener('click', function () {
      b.disabled = true;
      api('/auth/resend-verification', { method: 'POST' }).then(function (r) { toast(r.sent === false ? 'Email isn’t switched on yet. We’ll confirm you later.' : 'Confirmation email sent.', r.sent === false ? '' : 'ok'); })
        .catch(function (e) { toast(e.message, 'bad'); b.disabled = false; });
    });
  }

  function accountHome(view) {
    var u = state.user;
    view.innerHTML = verifyBanner() +
      '<div class="card" style="display:flex;align-items:center;gap:14px"><div class="avatar" style="width:56px;height:56px;font-size:20px">' + esc(initials(u.name, u.email)) + '</div>' +
      '<div style="min-width:0"><div class="h2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.name || 'Your account') + '</div><div class="small muted" style="overflow:hidden;text-overflow:ellipsis">' + esc(u.email) + '</div>' +
      '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="badge flame">' + roleName(u.role) + '</span>' + (u.totp_enabled ? '<span class="badge ok">2FA on</span>' : '') + '</div></div></div>' +
      '<div class="section-title">Settings</div><div class="list">' +
      row('#/account/profile', 'user', 'Profile', 'Name and language: ' + LANGS[u.language]) +
      row('#/account/security', 'shield', 'Security', u.totp_enabled ? 'Two-factor on · Password' : 'Turn on two-factor · Password') +
      row('#/account/sessions', 'devices', 'Devices', 'Where you’re signed in') +
      '<div class="set-row"><span class="ico">' + icon('palette') + '</span><span class="body"><div class="title">Appearance</div><div class="sub">Light, dark or match your device</div></span>' +
      '<div class="seg" role="group" aria-label="Theme" data-theme-seg>' + [['dark', 'Dark'], ['light', 'Light'], ['system', 'Auto']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="' + (theme.get() === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="section-title">About</div><div class="list">' + row('#/terms', 'file', 'Terms of Service', '') + row('#/privacy', 'lock', 'Privacy Policy', '') + '</div>' +
      '<div style="margin-top:24px"><button class="btn block" data-logout>' + icon('out') + ' Sign out</button></div>' +
      '<p class="tiny muted" style="text-align:center;margin-top:18px">Colon AI by Nifelux</p>';
    bindBanner(view);
    $$('[data-theme-seg] button', view).forEach(function (b) { b.addEventListener('click', function () { theme.set(b.getAttribute('data-t')); $$('[data-theme-seg] button', view).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }); });
    $('[data-logout]', view).addEventListener('click', function () {
      api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { state.user = null; go('/login', true); });
    });
  }
  function row(href, ic, title, sub) {
    return '<a class="row" href="' + href + '"><span class="ico">' + icon(ic) + '</span><span class="body"><div class="title">' + esc(title) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</span><span class="chev">' + icon('chev') + '</span></a>';
  }

  function profilePage(view) {
    var u = state.user;
    view.innerHTML = '<h1 class="h1">Profile</h1><p class="lead">How Colon greets you and the language it answers in.</p><form class="form card" novalidate>' +
      field({ name: 'name', label: 'Name', value: u.name, auto: 'name', max: 80 }) +
      field({ name: 'language', label: 'Preferred language', type: 'select', value: u.language, options: Object.keys(LANGS).map(function (k) { return [k, LANGS[k]]; }) }) +
      '<div class="field"><label>Email</label><input class="input" value="' + esc(u.email) + '" disabled></div>' +
      '<button class="btn primary block" type="submit">Save changes</button></form>';
    bindForm($('form', view), function (d) {
      return api('/account/profile', { method: 'PATCH', body: d }).then(function (r) { state.user = r.user; toast('Profile saved.', 'ok'); });
    });
  }

  function securityPage(view) {
    var u = state.user, staff = u.role !== 'user';
    view.innerHTML = '<h1 class="h1">Security</h1><p class="lead">Keep your Colon account safe.</p>' +
      '<div class="section-title">Two-factor authentication</div><div class="card">' +
      '<div style="display:flex;gap:12px;align-items:flex-start"><span class="ico" style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--surface-2);flex:none">' + icon('phone') + '</span>' +
      '<div style="flex:1"><div class="h3">Authenticator app ' + (u.totp_enabled ? '<span class="badge ok">On</span>' : '<span class="badge">Off</span>') + '</div><p class="small muted" style="margin:4px 0 0">' +
      (u.totp_enabled ? 'You’ll enter a code from your app when you sign in.' : 'Add a 6-digit code from Google Authenticator or Authy at sign-in.' + (staff ? ' Required for admin roles.' : '')) + '</p></div></div>' +
      '<div style="margin-top:14px">' + (u.totp_enabled ? (staff ? '<p class="tiny muted">Admin accounts must keep two-factor on.</p>' : '<button class="btn block danger" data-2fa-off>Turn off</button>') : '<button class="btn primary block" data-2fa-on>Set up two-factor</button>') + '</div></div>' +
      (u.has_password ? '<div class="section-title">Password</div><form class="form card" novalidate>' +
        field({ name: 'current_password', label: 'Current password', type: 'password', auto: 'current-password' }) +
        field({ name: 'new_password', label: 'New password', type: 'password', auto: 'new-password', meter: true }) +
        '<button class="btn block" type="submit">Change password</button><p class="tiny muted" style="margin:0">Other devices will be signed out.</p></form>' : '') +
      '<div class="section-title">Danger zone</div><div class="list"><button class="row" data-delete><span class="ico" style="color:var(--bad)">' + icon('trash') + '</span><span class="body"><div class="title" style="color:#ff8a96">Delete account</div><div class="sub">Permanently remove your account</div></span></button></div>';

    var pf = $('form', view);
    if (pf) bindForm(pf, function (d) { return api('/account/password', { method: 'POST', body: d }).then(function () { pf.reset(); toast('Password changed.', 'ok'); }); });

    var on = $('[data-2fa-on]', view);
    if (on) on.addEventListener('click', function () {
      on.disabled = true;
      api('/account/2fa/setup', { method: 'POST' }).then(function (s) {
        on.disabled = false;
        var key = s.secret.replace(/(.{4})/g, '$1 ').trim();
        sheet('<div class="h2">Set up two-factor</div><p class="small muted">1. Open your authenticator app, or tap below if it’s on this phone.</p>' +
          '<a class="btn block" href="' + esc(s.otpauth) + '">' + icon('key') + ' Open authenticator app</a>' +
          '<p class="small muted">Or enter this key manually:</p><div class="card mono" style="display:flex;align-items:center;gap:8px;padding:12px 14px"><span style="flex:1;word-break:break-all">' + esc(key) + '</span><button class="icon-btn" data-copy aria-label="Copy key">' + icon('copy') + '</button></div>' +
          '<p class="small muted">2. Enter the 6-digit code it shows.</p><form class="form" novalidate>' + field({ name: 'code', label: 'Code', mode: 'numeric', auto: 'one-time-code', max: 6, cls: 'code-input', placeholder: '••••••' }) +
          '<button class="btn primary block" type="submit">Turn on</button></form>', function (el, close) {
          $('[data-copy]', el).addEventListener('click', function () { navigator.clipboard && navigator.clipboard.writeText(s.secret).then(function () { toast('Key copied.'); }); });
          bindForm($('form', el), function (d) {
            return api('/account/2fa/enable', { method: 'POST', body: d }).then(function () { close(); toast('Two-factor is on.', 'ok'); return refreshUser().then(function () { securityPage(view); }); });
          });
        });
      }).catch(function (e) { on.disabled = false; toast(e.code === 'app_secret_missing' ? 'Two-factor isn’t available yet. The server needs its security key.' : e.message, 'bad'); });
    });

    var off = $('[data-2fa-off]', view);
    if (off) off.addEventListener('click', function () {
      sheet('<div class="h2">Turn off two-factor?</div><p class="small muted">Your account will be protected by password only.</p><form class="form" novalidate>' +
        (u.has_password ? field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) : '') +
        field({ name: 'code', label: 'Code from your app', mode: 'numeric', auto: 'one-time-code', max: 6, cls: 'code-input' }) +
        '<button class="btn danger block" type="submit">Turn off</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>', function (el, close) {
        bindForm($('form', el), function (d) { return api('/account/2fa/disable', { method: 'POST', body: d }).then(function () { close(); toast('Two-factor is off.'); return refreshUser().then(function () { securityPage(view); }); }); });
      });
    });

    $('[data-delete]', view).addEventListener('click', function () {
      sheet('<div class="h2" style="color:#ff8a96">Delete your account?</div><p class="small muted">This permanently removes your profile and signs you out everywhere. It can’t be undone.</p><form class="form" novalidate>' +
        (u.has_password ? field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) : '') +
        field({ name: 'confirm', label: 'Type DELETE to confirm', auto: 'off', placeholder: 'DELETE' }) +
        '<button class="btn danger block" type="submit">Delete account</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>', function (el, close) {
        bindForm($('form', el), function (d) { return api('/account/delete', { method: 'POST', body: d }).then(function () { close(); state.user = null; toast('Your account was deleted.'); go('/login', true); }); });
      });
    });
  }

  function sessionsPage(view) {
    view.innerHTML = '<h1 class="h1">Devices</h1><p class="lead">Where your account is signed in.</p><div class="list" id="sl"><div style="padding:16px"><div class="skel" style="height:44px"></div><div class="skel" style="height:44px;margin-top:12px"></div></div></div>' +
      '<button class="btn block" style="margin-top:16px" data-others>' + icon('out') + ' Sign out all other devices</button>';
    function load() {
      api('/account/sessions').then(function (d) {
        $('#sl', view).innerHTML = d.sessions.map(function (s) {
          return '<div class="row"><span class="ico">' + icon(/Android|iPhone/.test(s.user_agent) ? 'phone' : 'devices') + '</span><span class="body"><div class="title">' + esc(device(s.user_agent)) + (s.current ? ' <span class="badge ok">This device</span>' : '') + '</div><div class="sub">' + esc(s.ip) + ' · Active ' + ago(s.last_seen_at) + '</div></span>' +
            (s.current ? '' : '<button class="btn sm" data-revoke="' + s.id + '">Sign out</button>') + '</div>';
        }).join('');
        $$('[data-revoke]', view).forEach(function (b) {
          b.addEventListener('click', function () { b.disabled = true; api('/account/sessions/' + b.getAttribute('data-revoke'), { method: 'DELETE' }).then(function () { toast('Device signed out.'); load(); }).catch(function (e) { toast(e.message, 'bad'); b.disabled = false; }); });
        });
      }).catch(function (e) { $('#sl', view).innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }
    load();
    $('[data-others]', view).addEventListener('click', function (e) {
      var b = e.currentTarget; b.disabled = true;
      api('/account/sessions/revoke-others', { method: 'POST' }).then(function () { toast('Other devices signed out.', 'ok'); load(); }).catch(function (err) { toast(err.message, 'bad'); }).then(function () { b.disabled = false; });
    });
  }

  /* ---------- Boot ---------- */
  function refreshUser() { return api('/auth/me').then(function (d) { state.user = d.user; return d.user; }); }

  function start(opts) {
    state.app = opts.app; state.title = opts.title; state.subtitle = opts.subtitle || ''; state.nav = opts.nav || [];
    state.brand = opts.brand || (opts.title || 'Colon AI').toUpperCase();
    state.allowSignup = opts.allowSignup !== false;
    var all = (opts.routes || []).concat(authRoutes);
    routes = all.map(function (r) { return Object.assign({}, r, { re: new RegExp('^' + r.path.replace(/:[a-z]+/g, '([^/]+)') + '$') }); });
    var root = $('#app');
    root.innerHTML = '<div class="auth"><div class="inner" style="text-align:center"><div class="brand">' + logo(state.brand, 'by Nifelux', 'lg') + '</div><div class="skel" style="height:8px;width:120px;margin:0 auto"></div></div></div>';
    Promise.all([refreshUser().catch(function () { return null; }), api('/auth/config').then(function (c) { state.config = c; }).catch(function () {})]).then(function () {
      window.addEventListener('hashchange', render);
      render();
    });
  }

  window.Colon = { start: start, api: api, icon: icon, esc: esc, $: $, $$: $$, toast: toast, sheet: sheet, field: field, bindForm: bindForm, go: go,
    ago: ago, device: device, initials: initials, roleName: roleName, hasRole: hasRole, LANGS: LANGS, MARK: MARK, logo: logo,
    theme: theme, menu: menu, confirm: confirmDialog, prompt: promptDialog, drawer: drawer, keyboard: keyboard, resizable: resizable,
    copyText: copyText, fmtBytes: fmtBytes, uid: uid, debounce: debounce, trapFocus: trapFocus, get API() { return API; },
    logout: function () { return api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { state.user = null; go('/login', true); }); },
    get user() { return state.user; }, refreshUser: refreshUser, verifyBanner: verifyBanner, bindBanner: bindBanner, row: row };
})();
