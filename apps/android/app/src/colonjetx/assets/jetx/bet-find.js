/* Colon JetX for Android (0.38.0, Crash Predictor step 5): finding the game's Bet button, its auto cash-out field
   and its stake field. READ-ONLY: it only looks at elements, their labels and values. Used by autobet-click.js (the
   real-money click, only on the app's command) and manual-watch.js (the user's own bets, read-only); the app puts
   this file and one of those in one function (JetxAutobet.script), so JetxBetFind never becomes a page global.
   Labels are matched in English as SportyBet's JetX shows them; anything not found is reported, never guessed.
   A game drawn in a canvas has no such elements: then nothing is found and nothing is done (fail closed).
   In node it is a module (services/api/tests/unit/jetx-autobet-click.test.js). */
var JetxBetFind = (function () {
  'use strict';
  var BET = /^\s*(place\s+)?bet\b/i, CASH = /cash\s*-?\s*out|collect|cancel/i;
  var AUTO = /auto\s*(cash\s*-?\s*out|collect)/i, STAKE = /\b(stake|amount|bet\s*amount)\b/i;
  var MAX_NODES = 6000, MAX_UP = 4;

  function norm(t) { return String(t == null ? '' : t).replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim(); }

  // Every element under root, open shadow roots included, in document order (at most MAX_NODES).
  function all(root) {
    var out = [], start = root && (root.body || root.documentElement || root), stack = start ? [start] : [];
    while (stack.length && out.length < MAX_NODES) {
      var el = stack.pop(), kids = el.children || [], sr = el.shadowRoot, i;
      out.push(el);
      var sk = (sr && sr.children) || [];
      for (i = sk.length - 1; i >= 0; i--) stack.push(sk[i]);
      for (i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }

  function attr(el, a) { try { return el.getAttribute ? el.getAttribute(a) || '' : ''; } catch (e) { return ''; } }
  function isButton(el) {
    var tag = String(el.tagName || '');
    return tag === 'BUTTON' || attr(el, 'role') === 'button' || (tag === 'INPUT' && /^(button|submit)$/i
      .test(attr(el, 'type')));
  }
  function usable(el) { return !el.disabled && !el.hidden && attr(el, 'aria-disabled') !== 'true'; }
  function textOf(el) { return norm(el.tagName === 'INPUT' ? el.value : el.textContent).slice(0, 80); }

  // The words that describe a field: its aria-label, name, id, placeholder and the text of up to MAX_UP ancestors'
  // own short text (a label beside it), never more than 200 characters.
  function labelOf(el) {
    var parts = [attr(el, 'aria-label'), attr(el, 'name'), attr(el, 'id'), attr(el, 'placeholder')];
    var p = el.parentElement || el.parentNode, n = 0;
    while (p && n < MAX_UP && p.children) {
      var t = norm(p.textContent);
      if (t.length <= 60) parts.push(t);
      p = p.parentElement || p.parentNode; n++;
    }
    return norm(parts.join(' ')).slice(0, 200);
  }
  function isField(el) {
    return String(el.tagName || '') === 'INPUT' && /^(|text|number|tel|decimal)$/i.test(attr(el, 'type'));
  }

  // The first usable Bet button (not Cash out or Cancel), or null.
  function findBet(root) {
    var els = all(root);
    for (var i = 0; i < els.length; i++) {
      var el = els[i], t = textOf(el);
      if (isButton(el) && usable(el) && BET.test(t) && !CASH.test(t)) return el;
    }
    return null;
  }
  // The auto cash-out field (labelled "Auto cash out" / "Auto collect"), or null.
  function findAuto(root) {
    var els = all(root);
    for (var i = 0; i < els.length; i++) if (isField(els[i]) && AUTO.test(labelOf(els[i]))) return els[i];
    return null;
  }
  // The stake field (labelled stake / amount, and not the auto cash-out), or null.
  function findStake(root) {
    var els = all(root);
    for (var i = 0; i < els.length; i++) {
      var l = labelOf(els[i]);
      if (isField(els[i]) && STAKE.test(l) && !AUTO.test(l)) return els[i];
    }
    return null;
  }
  // A checkbox / switch next to the auto cash-out field that is off -> true (auto cash-out is not on).
  function autoOff(field) {
    var p = field && (field.parentElement || field.parentNode), n = 0;
    while (p && n < MAX_UP) {
      var kids = all(p);
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k !== field && String(k.tagName) === 'INPUT' && /checkbox/i.test(attr(k, 'type'))) return !k.checked;
        if (attr(k, 'role') === 'switch') return attr(k, 'aria-checked') === 'false';
      }
      p = p.parentElement || p.parentNode; n++;
    }
    return false;
  }
  // "1,000.50" or "1.30" -> a number, or null.
  function numberOf(v) {
    var s = norm(v).replace(/[^0-9.,]/g, '');
    if (/,\d{1,2}$/.test(s) && s.indexOf('.') < 0) s = s.replace(',', '.');
    s = s.replace(/,/g, '');
    var n = Number(s);
    return s && Number.isFinite(n) ? n : null;
  }
  return { norm: norm, all: all, findBet: findBet, findAuto: findAuto, findStake: findStake, autoOff: autoOff,
    numberOf: numberOf, labelOf: labelOf, BET: BET, CASH: CASH };
})();
if (typeof module === 'object' && module && module.exports) module.exports = JetxBetFind;
