/* Colon JetX for Android (0.35.0, Crash Predictor step 3; 0.35.1 tolerant strip + diagnostics): the round collector
   in the GAME pane.
   Injected at document start by JetxCollector.kt into every frame of the betting site (JetX usually runs in the
   game provider's iframe). READ-ONLY: it watches the page for JetX's round-history strip (a row of finished
   multipliers such as "1.53x") and, when a new one appears, sends { multiplier, seen_at, round_id? } to the app over
   window.ColonJetXRounds, a channel that carries nothing else and never answers. It never clicks, types, reads
   form fields, passwords, cookies or storage, and sends no other text from the page. Only multiplier-shaped text
   is matched; everything else it looks at stays in this function. Since 0.35.1 it also sends, at most every 10 s,
   a diagnostic { diag: { frame_host, strip_found, items } } on the same channel: the frame's host name and two
   counts, no page text.
   In node (the unit test, services/api/tests/unit/jetx-collector.test.js) it exports its pure parts instead. */
(function (root, factory) {
  'use strict';
  var P = factory();
  if (typeof module === 'object' && module && module.exports) { module.exports = P; return; }
  P.install(root);
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var MULT = /^(\d{1,7})(?:[.,](\d{1,2}))?\s*[x\u00d7]$/i;
  var ID = /^[A-Za-z0-9_.:-]{1,64}$/;
  var ID_ATTRS = ['data-round-id', 'data-roundid', 'data-round', 'data-game-id'];
  var SKIP = { BUTTON: 1, INPUT: 1, A: 1, SELECT: 1, TEXTAREA: 1, LABEL: 1, OPTION: 1, FORM: 1, SCRIPT: 1,
    STYLE: 1 };
  // A chip may itself be a button or link (its text is still only read); form fields never are.
  var NO_CHIP = { INPUT: 1, SELECT: 1, TEXTAREA: 1, LABEL: 1, OPTION: 1, FORM: 1, SCRIPT: 1, STYLE: 1 };
  var MIN_STRIP = 5, MAX_STRIP = 200, MIN_SHARE = 0.7, MIN_OVERLAP = 3, MAX_NEW = 10, GAP_MS = 3000;
  var MAX_NODES = 6000, MAX_LEAVES = 30, MAX_TEXT = 40, DIAG_MS = 10000;

  // "1.53x", "12,00 x", "2x" -> 1.53, 12, 2; anything else (no x, more decimals, below 1x) -> null.
  function parseMultiplier(text) {
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (s.length > 16) return null;
    var m = MULT.exec(s);
    if (!m) return null;
    var n = Number(m[1] + (m[2] ? '.' + m[2] : ''));
    return n >= 1 && n <= 1e6 ? Math.round(n * 100) / 100 : null;
  }

  // A round id from a history item's own attributes, when the game shows one. get(name) -> value | null.
  function roundIdOf(get) {
    for (var i = 0; i < ID_ATTRS.length; i++) {
      var v = get(ID_ATTRS[i]);
      if (v != null && ID.test(String(v).trim())) return String(v).trim();
    }
    return null;
  }

  // texts of a container's children -> the strip's items [{ m, id }] or null when it is not a history strip:
  // at least 5 multiplier-shaped items making up at least 70% of the children. The rest (a dropdown chevron, an
  // icon, an empty or half-visible "1.2…" chip) is skipped, not a reason to give up. items: [{ text, id? }]
  function readStrip(items) {
    if (!items || items.length < MIN_STRIP || items.length > MAX_STRIP) return null;
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var m = items[i] ? parseMultiplier(items[i].text) : null;
      if (m != null) out.push({ m: m, id: items[i].id || null });
    }
    return out.length >= MIN_STRIP && out.length >= MIN_SHARE * items.length ? out : null;
  }

  function trimmed(el) {
    var t = el && el.textContent;
    return t ? String(t).replace(/\s+/g, ' ').trim() : '';
  }

  // One child of a candidate strip -> its multiplier-shaped text, or '' (skipped). Its own text first ("6.49x",
  // also when split over spans); else the one descendant leaf that holds a multiplier (a chip with a tooltip).
  function chipText(c) {
    if (!c || NO_CHIP[c.tagName]) return '';
    var t = trimmed(c);
    if (!t) return '';
    if (t.length <= MAX_TEXT && parseMultiplier(t) != null) return t;
    var found = '', seen = 0, stack = [c];
    while (stack.length && seen < MAX_LEAVES) {
      var el = stack.pop(), kids = el.children || [];
      seen++;
      if (el !== c && !kids.length) {
        var lt = trimmed(el);
        if (lt && parseMultiplier(lt) != null) { if (found) return ''; found = lt; }
        continue;
      }
      for (var i = kids.length - 1; i >= 0; i--) if (!NO_CHIP[kids[i].tagName]) stack.push(kids[i]);
    }
    return found;
  }

  // A container element -> its children as strip items [{ text, id }], or null when it can't be a strip.
  function itemsOf(el) {
    var kids = el && el.children;
    if (!kids || kids.length < MIN_STRIP || kids.length > MAX_STRIP || SKIP[el.tagName]) return null;
    var items = [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      items.push({ text: chipText(c), id: c.getAttribute ? roundIdOf(function (a) { return c.getAttribute(a); })
        : null });
    }
    return items;
  }

  // The best history strip under root (a document, element or open shadow root): the container with the most
  // multiplier items, searched through nested wrappers and open shadow roots, never inside buttons, links or forms.
  function findStrip(root) {
    var start = root && (root.body || root.documentElement || root), stack = start ? [start] : [];
    var best = null, bestN = 0, seen = 0;
    while (stack.length && seen < MAX_NODES) {
      var el = stack.pop(), kids = el.children || [];
      seen++;
      if (el.tagName && SKIP[el.tagName]) continue;
      if (kids.length >= MIN_STRIP) {
        var s = readStrip(itemsOf(el));
        if (s && s.length > bestN) { best = el; bestN = s.length; }
      }
      for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      if (el.shadowRoot && el.shadowRoot.children) {
        for (var j = el.shadowRoot.children.length - 1; j >= 0; j--) stack.push(el.shadowRoot.children[j]);
      }
    }
    return best;
  }

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
    var strip = null, prev = null, dir = null, pending = false, lastSearch = 0, lastDiag = 0;
    var host = String((win.location && win.location.hostname) || '').slice(0, 100);

    function send(msg) {
      try { port.postMessage(JSON.stringify(msg)); } catch (e) { /* the app went away */ }
    }

    function diag(cur) {
      var now = Date.now();
      if (now - lastDiag < DIAG_MS) return;
      lastDiag = now;
      send({ diag: { frame_host: host, strip_found: !!cur, items: cur ? cur.length : 0 } });
    }

    function scan() {
      pending = false;
      var cur = strip && strip.isConnected ? readStrip(itemsOf(strip)) : null;
      if (!cur) {
        if (Date.now() - lastSearch < 2000) { diag(null); later(2000); return; }
        lastSearch = Date.now();
        strip = findStrip(doc);
        cur = strip ? readStrip(itemsOf(strip)) : null;
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

  return { parseMultiplier: parseMultiplier, roundIdOf: roundIdOf, readStrip: readStrip, diffStrip: diffStrip,
    messages: messages, chipText: chipText, itemsOf: itemsOf, findStrip: findStrip, install: install, GAP_MS: GAP_MS };
});
