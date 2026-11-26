/* Colon JetX for Android (0.37.0, Crash Predictor step 5): the user's own bets, READ-ONLY. JetxAutobet injects
   bet-find.js and this file (one function) into the game pane's frames. When the user (a trusted tap, never a
   script's click, so never Colon's own auto-bet) presses a Bet button, it reads the stake field and, when auto
   cash-out is on, the auto cash-out field, and posts { manual: { stake, target, at } } on window.ColonJetXManual.
   Nothing else: no page text, cookies, storage, passwords or tokens, and it never clicks or types. When the stake
   can't be read (a canvas game) it sends nothing. In node it exports read() for the test. */
(function (root, factory) {
  'use strict';
  /* global JetxBetFind */
  var P = factory(typeof JetxBetFind !== 'undefined' ? JetxBetFind : require('./bet-find.js'));
  if (typeof module === 'object' && module && module.exports) { module.exports = P; return; }
  P.install(root);
})(typeof window !== 'undefined' ? window : this, function (F) {
  'use strict';

  // The Bet button a tap landed on (the target or an ancestor up to 4 levels, across a shadow root), or null.
  function betButtonOf(path) {
    for (var i = 0; i < Math.min(path.length, 6); i++) {
      var el = path[i];
      if (!el || !el.tagName) continue;
      var t = F.norm(el.textContent).slice(0, 80);
      var btn = String(el.tagName) === 'BUTTON' || (el.getAttribute && el.getAttribute('role') === 'button');
      if (btn) return F.BET.test(t) && !F.CASH.test(t) ? el : null;
    }
    return null;
  }

  // doc, now -> { stake, target, at } or null.
  function read(doc, now) {
    var stake = F.findStake(doc), auto = F.findAuto(doc);
    var s = stake ? F.numberOf(stake.value) : null;
    if (s == null || !(s >= 0.01 && s <= 1e7)) return null;
    var t = auto && !F.autoOff(auto) ? F.numberOf(auto.value) : null;
    if (t != null && !(t >= 1.01 && t <= 10000)) t = null;
    return { stake: Math.round(s * 100) / 100, target: t == null ? null : Math.round(t * 100) / 100, at: now };
  }

  function install(win) {
    var port = win && win.ColonJetXManual, doc = win && win.document;
    if (!port || typeof port.postMessage !== 'function' || !doc || !doc.addEventListener) return;
    doc.addEventListener('click', function (e) {
      if (!e || !e.isTrusted) return;
      var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      if (!betButtonOf(path)) return;
      var m = read(doc, Date.now());
      if (!m) return;
      try { port.postMessage(JSON.stringify({ manual: m })); } catch (x) { /* app went away */ }
    }, true);
  }

  return { read: read, betButtonOf: betButtonOf, install: install };
});
