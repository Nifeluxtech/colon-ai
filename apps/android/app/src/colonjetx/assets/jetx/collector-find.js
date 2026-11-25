/* Colon JetX for Android (0.35.2): how the round collector (collector.js) finds and reads JetX's history strip.
   JetxRoundRules.script() puts this file and collector.js together inside one function and injects that into
   every frame of the game pane, so JetxFind never becomes a global of the page. READ-ONLY like collector.js: it
   only reads elements' text and computed ::after content, and sends nothing itself.
   Strips: one container whose children are chips (findStrip), or chips in the rows of a grid grouped under their
   nearest common ancestor up to 4 levels up (findGrouped). A chip reads "1.07x", "1,07 ×" or "1.07X" (zero-width
   characters and NBSP dropped), or a bare "1.07" whose x is drawn by CSS ::after; bare numbers without an x count
   only when at least 5 of them make up 80% of a strip. In node it is a module (services/api/tests/unit). */
var JetxFind = (function () {
  'use strict';
  var MULT = /^(\d{1,7})(?:[.,](\d{1,2}))?\s*[x\u00d7]$/i, BARE = /^(\d{1,7})[.,](\d{2})$/;
  // Near matches for the diagnostic: a number followed by an x anywhere ("3.96x4.35x"), or a bare "1.07".
  var LOOSE = /\d(?:[.,]\d{1,2})?\s*[x\u00d7]|^\d{1,7}[.,]\d{2}$/i, SAFE = /^[0-9.,xX\u00d7 ]{1,12}$/;
  var ZW = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;
  var ID = /^[A-Za-z0-9_.:-]{1,64}$/;
  var ID_ATTRS = ['data-round-id', 'data-roundid', 'data-round', 'data-game-id'];
  var SKIP = { BUTTON: 1, INPUT: 1, A: 1, SELECT: 1, TEXTAREA: 1, LABEL: 1, OPTION: 1, FORM: 1, SCRIPT: 1,
    STYLE: 1 };
  // A chip may itself be a button or link (its text is still only read); form fields never are.
  var NO_CHIP = { INPUT: 1, SELECT: 1, TEXTAREA: 1, LABEL: 1, OPTION: 1, FORM: 1, SCRIPT: 1, STYLE: 1 };
  var MIN_STRIP = 5, MAX_STRIP = 200, MIN_SHARE = 0.7, BARE_SHARE = 0.8, GROUP_SHARE = 0.5, GROUP_UP = 4;
  var MAX_NODES = 6000, MAX_LEAVES = 30, MAX_TEXT = 40, MAX_COUNT = 99999;
  var env = { style: null };

  // Page text -> one plain line: zero-width characters and soft hyphens dropped, any spaces (NBSP too) as one.
  function norm(text) { return String(text == null ? '' : text).replace(ZW, '').replace(/\s+/g, ' ').trim(); }

  function num(m) {
    var n = Number(m[1] + (m[2] ? '.' + m[2] : ''));
    return n >= 1 && n <= 1e6 ? Math.round(n * 100) / 100 : null;
  }

  // "1.53x", "12,00 x", "2×" -> 1.53, 12, 2; anything else (no x, more decimals, below 1x) -> null.
  function parseMultiplier(text) {
    var s = norm(text), m = s.length <= 16 && MULT.exec(s);
    return m ? num(m) : null;
  }

  // A bare "1.07" / "1,07" (exactly two decimals) -> 1.07, else null. Taken only with the strip rules below.
  function parseBare(text) {
    var s = norm(text), m = s.length <= 10 && BARE.exec(s);
    return m ? num(m) : null;
  }

  // The getComputedStyle the page side uses (a stub in the tests): it shows whether a chip's x is drawn by CSS.
  function useStyle(fn) { env.style = typeof fn === 'function' ? fn : null; }

  // True when el (or its last nested child) draws an "x" in its ::after pseudo-element.
  function afterX(el) {
    for (var d = 0; el && d < 3; d++, el = el.children && el.children[el.children.length - 1]) {
      try {
        var c = env.style && String(env.style(el, '::after').content || '');
        if (c && c.length <= 6 && /[x\u00d7]/i.test(c)) return true;
      } catch (e) { return false; }
    }
    return false;
  }

  // An element and its normalized text -> the text as a multiplier ("1.07x"; "1.07" + CSS x -> "1.07x"), a bare
  // "1.07" (a maybe, see readStrip), or ''.
  function valueText(el, t) {
    if (parseMultiplier(t) != null) return t;
    if (parseBare(t) == null) return '';
    return afterX(el) ? t + 'x' : t;
  }

  // A safe id from a history item's own attributes, when the game shows one. get(name) -> value | null.
  function roundIdOf(get) {
    for (var i = 0; i < ID_ATTRS.length; i++) {
      var v = get(ID_ATTRS[i]);
      if (v != null && ID.test(String(v).trim())) return String(v).trim();
    }
    return null;
  }

  function idOf(el) {
    return el && el.getAttribute ? roundIdOf(function (a) { return el.getAttribute(a); }) : null;
  }

  // items [{ text, id? }] -> the strip's items [{ m, id }] or null when it is not a history strip: at least 5
  // multipliers making up at least share (70%) of the items. The rest (a chevron, an icon, a half-visible chip) is
  // skipped. Bare "1.07" items count only when at least 5 of them make up 80% of the items (an x drawn some other way).
  function readStrip(items, share) {
    if (!items || items.length < MIN_STRIP || items.length > MAX_STRIP) return null;
    var out = [], bare = 0;
    for (var i = 0; i < items.length; i++) {
      var t = items[i] && items[i].text, m = parseMultiplier(t), b = m == null ? parseBare(t) : null;
      if (b != null) bare++;
      if (m != null || b != null) out.push({ m: m != null ? m : b, id: items[i].id || null, bare: b != null });
    }
    var bareOk = bare >= MIN_STRIP && bare >= BARE_SHARE * items.length;
    if (!bareOk) out = out.filter(function (x) { return !x.bare; });
    if (out.length < MIN_STRIP || out.length < (share || MIN_SHARE) * items.length) return null;
    return out.map(function (x) { return { m: x.m, id: x.id }; });
  }

  // One child of a candidate strip -> its multiplier text, a bare number, or '' (skipped). Its own text first
  // ("6.49x", also when split over spans); else the one descendant leaf that holds a multiplier.
  function chipText(c) {
    if (!c || NO_CHIP[c.tagName]) return '';
    var t = norm(c.textContent), v = t && t.length <= MAX_TEXT ? valueText(c, t) : '';
    if (!t || v) return v;
    var found = '', seen = 0, stack = [c];
    while (stack.length && seen < MAX_LEAVES) {
      var el = stack.pop(), kids = el.children || [];
      seen++;
      if (el !== c && !kids.length) {
        var lt = valueText(el, norm(el.textContent));
        if (lt) { if (found) return ''; found = lt; }
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
    for (var i = 0; i < kids.length; i++) items.push({ text: chipText(kids[i]), id: idOf(kids[i]) });
    return items;
  }

  // Walks root (a document, element or open shadow root) depth first in document order, open shadow roots too.
  // visit(el, ancestors up to GROUP_UP, depth) returns false to skip el's subtree.
  function walk(root, visit, maxDepth) {
    var start = root && (root.body || root.documentElement || root), stack = start ? [[start, [], 0]] : [], seen = 0;
    while (stack.length && seen < MAX_NODES) {
      var top = stack.pop(), el = top[0], kids = el.children || [], sr = el.shadowRoot, i;
      seen++;
      if (visit(el, top[1], top[2]) === false || top[2] >= (maxDepth || 1e9)) continue;
      var up = [el].concat(top[1]).slice(0, GROUP_UP);
      for (i = kids.length - 1; i >= 0; i--) stack.push([kids[i], up, top[2] + 1]);
      if (sr && sr.children) for (i = sr.children.length - 1; i >= 0; i--) stack.push([sr.children[i], up, top[2] + 1]);
    }
  }

  // The best history strip under root: the container with the most multiplier items, never inside buttons,
  // links or forms.
  function findStrip(root) {
    var best = null, bestN = 0;
    walk(root, function (el) {
      if (SKIP[el.tagName]) return false;
      if ((el.children || []).length < MIN_STRIP) return;
      var s = readStrip(itemsOf(el));
      if (s && s.length > bestN) { best = el; bestN = s.length; }
    });
    return best;
  }

  // el -> 'chip' (its whole short text is a multiplier or bare number), 'like' (a short leaf with a digit: a chip
  // we can't read), 'skip' (form fields, scripts) or '' (look inside).
  function chipKind(el) {
    if (NO_CHIP[el.tagName]) return 'skip';
    var kids = el.children || [];
    if (kids.length > 3) return SKIP[el.tagName] ? 'skip' : '';
    var t = norm(el.textContent);
    if (t && t.length <= 16 && valueText(el, t)) return 'chip';
    if (kids.length && !SKIP[el.tagName]) return '';
    return t && t.length <= 16 && /\d/.test(t) ? 'like' : 'skip';
  }

  // The chips under a grouped strip (rows inside a grid), up to GROUP_UP levels down, in document order, with an
  // empty item for each short leaf that isn't one -> strip items.
  function leafItems(box) {
    var items = [];
    walk(box, function (el) {
      if (el === box) return;
      var k = chipKind(el);
      if (k === 'chip') items.push({ text: valueText(el, norm(el.textContent)), id: idOf(el) });
      else if (k === 'like') items.push({ text: '' });
      return k ? false : undefined;
    }, GROUP_UP);
    return items;
  }

  // When no one container holds the chips (a grid of rows, each its own parent): the ancestor, up to 4 levels up,
  // over the most chips, at least 5 of them and most of its short leaves -> that element, read with leafItems.
  function findGrouped(root) {
    var stats = new Map(), best = null, bestN = 0;
    walk(root, function (el, anc) {
      var k = chipKind(el);
      if (k === 'chip' || k === 'like') {
        anc.forEach(function (a) {
          var s = stats.get(a) || { chips: 0, like: 0 };
          s.chips += k === 'chip' ? 1 : 0; s.like++;
          stats.set(a, s);
        });
      }
      return k ? false : undefined;
    });
    stats.forEach(function (s, a) {
      if (s.chips < MIN_STRIP || s.chips <= bestN || s.chips * 2 <= s.like) return;
      if (readStrip(leafItems(a), GROUP_SHARE)) { best = a; bestN = s.chips; }
    });
    return best;
  }

  // A text-free look at the frame for the diagnostic: how many short leaves look like multipliers, canvases,
  // open shadow hosts, custom elements that are empty (maybe a closed shadow root), and up to 3 samples made only
  // of [0-9.,xX× ] (never other page text), x-shaped ones first.
  function diagStats(root) {
    var d = { mult_texts: 0, canvases: 0, shadow_hosts: 0, closed_hint: 0 }, xs = [], bare = [];
    walk(root, function (el) {
      var tag = String(el.tagName || ''), kids = el.children || [];
      if (tag === 'CANVAS') d.canvases++;
      if (el.shadowRoot) d.shadow_hosts++;
      else if (tag.indexOf('-') > 0 && !kids.length) d.closed_hint++;
      if (NO_CHIP[tag]) return false;
      if (kids.length) return;
      var t = norm(el.textContent);
      if (!t || t.length > 24 || !LOOSE.test(t)) return;
      d.mult_texts++;
      var s = t.slice(0, 12).trim();
      if (SAFE.test(s)) (/[x\u00d7]/i.test(s) ? xs : bare).push(s);
    });
    Object.keys(d).forEach(function (k) { d[k] = Math.min(d[k], MAX_COUNT); });
    d.sample = xs.concat(bare).slice(0, 3);
    return d;
  }
  return { norm: norm, parseMultiplier: parseMultiplier, parseBare: parseBare, roundIdOf: roundIdOf,
    readStrip: readStrip, chipText: chipText, itemsOf: itemsOf, findStrip: findStrip, findGrouped: findGrouped,
    leafItems: leafItems, diagStats: diagStats, useStyle: useStyle, GROUP_SHARE: GROUP_SHARE };
})();
if (typeof module === 'object' && module && module.exports) module.exports = JetxFind;
