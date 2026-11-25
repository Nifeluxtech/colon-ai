/* Colon JetX for Android (0.35.0, Crash Predictor step 3; 0.35.1 tolerant strip + diagnostics; 0.35.2 grouped
   strips, bare numbers, richer diagnostics): the round collector in the GAME pane.
   Injected at document start by JetxCollector.kt into every frame of the betting site (JetX usually runs in the
   game provider's iframe). READ-ONLY: it watches the page for JetX's round-history strip (a row or grid of finished
   multipliers such as "1.53x") and, when a new one appears, sends { multiplier, seen_at, round_id? } to the app over
   window.ColonJetXRounds, a channel that carries nothing else and never answers. It never clicks, types, reads
   form fields, passwords, cookies or storage, and sends no other text from the page. Only multiplier-shaped text
   is matched; everything else it looks at stays in this function. At most every 10 s it also sends a diagnostic
   { diag: { frame_host, strip_found, items, mult_texts, canvases, shadow_hosts, closed_hint, sample } } on the same
   channel: the frame's host name, counts and up to 3 samples of at most 12 characters from [0-9.,xX× ] only.
   Finding and reading the strip is in collector-find.js (JetxFind), injected together with this file.
   In node (the unit test, services/api/tests/unit/jetx-collector.test.js) it exports its pure parts instead. */
(function (root, factory) {
  'use strict';
  var node = typeof module === 'object' && module && module.exports;
  /* global JetxFind */
  var P = factory(typeof JetxFind !== 'undefined' ? JetxFind : require('./collector-find.js'));
  if (node) { module.exports = P; return; }
  P.install(root);
})(typeof window !== 'undefined' ? window : this, function (Find) {
  'use strict';
  var F = Find, MIN_OVERLAP = 3, MAX_NEW = 10, GAP_MS = 3000, DIAG_MS = 10000;
  var readStrip = F.readStrip, itemsOf = F.itemsOf, leafItems = F.leafItems, GROUP_SHARE = F.GROUP_SHARE;

  function same(a, b, n) {
    for (var i = 0; i < n; i++) if (a[i].m !== b[i].m) return false;
    return true;
  }

  // prev, cur: strips (newest first or newest last; dir remembers which once known) -> { added (oldest first),
  // dir, resync }. The first look (no prev) adds nothing: rounds already on screen have no time we saw them.
  function diffStrip(prev, cur, dir) {
    if (!prev || !prev.length) return { added: [], dir: dir || null, resync: true };
    var withIds = prev.every(function (x) { return x.id; }) && cur.every(function (x) { return x.id; });
    if (withIds) {
      var had = {};
      prev.forEach(function (x) { had[x.id] = 1; });
      var fresh = cur.filter(function (x) { return !had[x.id]; });
      if (!fresh.length) return { added: [], dir: dir || null };
      var atEnd = cur.indexOf(fresh[0]) > 0;
      if (fresh.length > MAX_NEW) return { added: [], dir: dir || null, resync: true };
      return { added: atEnd ? fresh : fresh.slice().reverse(), dir: atEnd ? 'append' : 'prepend' };
    }
    var need = Math.min(MIN_OVERLAP, prev.length), pre = -1, app = -1, k, n;
    for (k = 0; k <= MAX_NEW && k < cur.length; k++) {
      n = Math.min(prev.length, cur.length - k);
      if (n < need) break;
      if (same(cur.slice(k), prev, n)) { pre = k; break; }
    }
    for (k = 0; k <= MAX_NEW && k < prev.length; k++) {
      var tail = prev.slice(k);
      if (tail.length < need || tail.length > cur.length) continue;
      if (same(tail, cur, tail.length)) { app = cur.length - tail.length; break; }
    }
    if (pre === 0 || app === 0) return { added: [], dir: dir || null };
    var usePre = pre > 0 && (app < 0 || dir !== 'append');
    if (usePre) return { added: cur.slice(0, pre).reverse(), dir: 'prepend' };
    if (app > 0 && app <= MAX_NEW) return { added: cur.slice(cur.length - app), dir: 'append' };
    return { added: [], dir: dir || null, resync: true };
  }

  // added (oldest first) at time now -> the messages for the app. Several at once (the page was paused): the
  // newest gets now and each older one 3 s earlier, an approximate time that keeps them apart.
  function messages(added, now) {
    return added.map(function (x, i) {
      var msg = { multiplier: x.m, seen_at: now - (added.length - 1 - i) * GAP_MS };
      if (x.id) msg.round_id = x.id;
      return msg;
    });
  }

  /* ---------- the page side (not run in node) ---------- */

  function install(win) {
    var port = win && win.ColonJetXRounds, doc = win && win.document;
    if (!port || typeof port.postMessage !== 'function' || !doc || !win.MutationObserver) return;
    var strip = null, grouped = false, prev = null, dir = null, pending = false, lastSearch = 0, lastDiag = 0;
    var host = String((win.location && win.location.hostname) || '').slice(0, 100);
    var gcs = win.getComputedStyle;
    if (typeof gcs === 'function') F.useStyle(function (el, p) { return gcs.call(win, el, p); });

    function send(msg) {
      try { port.postMessage(JSON.stringify(msg)); } catch (e) { /* the app went away */ }
    }

    function diag(cur) {
      var now = Date.now();
      if (now - lastDiag < DIAG_MS) return;
      lastDiag = now;
      var d = F.diagStats(doc);
      d.frame_host = host; d.strip_found = !!cur; d.items = cur ? cur.length : 0;
      send({ diag: d });
    }

    function read() {
      if (!strip || !strip.isConnected) return null;
      return grouped ? readStrip(leafItems(strip), GROUP_SHARE) : readStrip(itemsOf(strip));
    }

    function scan() {
      pending = false;
      var cur = read();
      if (!cur) {
        if (Date.now() - lastSearch < 2000) { diag(null); later(2000); return; }
        lastSearch = Date.now();
        strip = F.findStrip(doc);
        grouped = !strip;
        if (grouped) strip = F.findGrouped(doc);
        cur = strip ? (grouped ? readStrip(leafItems(strip), GROUP_SHARE) : readStrip(itemsOf(strip))) : null;
        diag(cur);
        if (!cur) return;
        prev = null; // a new strip: look first, send nothing yet
      }
      diag(cur);
      var d = diffStrip(prev, cur, dir);
      if (d.dir) dir = d.dir;
      prev = cur;
      messages(d.added, Date.now()).forEach(send);
    }

    function later(ms) { if (!pending) { pending = true; win.setTimeout(scan, ms || 300); } }

    new win.MutationObserver(function () { later(300); })
      .observe(doc, { childList: true, subtree: true, characterData: true });
    // Changes inside shadow roots don't reach the observer, so look again every 2 s as well.
    win.setInterval(function () { later(0); }, 2000);
    later(1000);
  }

  var P = { diffStrip: diffStrip, messages: messages, install: install, GAP_MS: GAP_MS };
  Object.keys(F).forEach(function (k) { if (!(k in P)) P[k] = F[k]; });
  return P;
});
