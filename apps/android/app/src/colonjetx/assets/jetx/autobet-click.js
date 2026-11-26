/* Colon JetX for Android (0.37.0, Crash Predictor step 5): the real-money click, ISOLATED in its own file.
   JetxAutobet injects bet-find.js and this file (one function) into the game pane's frames. On its own it does
   NOTHING: it says hello ({ready:true}) on window.ColonJetXBet and then only answers the app's commands on that
   channel. The app sends a command only after the Colon API allowed a real-money bet (verdict BET, every guardrail
   clear), the app's own real-money switch is on (after its warning), the control mode is AI or Shared (Shared:
   the user confirmed this bet) and the kill switch is off
   (JetxAutobetRules.mayClick).
     { cmd: 'probe', nonce }              -> { nonce, ok, reason, step }: are the Bet button, the auto cash-out and
                                            the stake fields all here? Touches nothing.
     { cmd: 'bet', nonce, target, stake }   -> sets the auto cash-out to target and the stake, checks both read back,
                                              then presses Bet once -> { nonce, ok: true, reason: 'ok' }.
   FAIL CLOSED: if the Bet button, the auto cash-out field or the stake field is missing (a canvas game), auto
   cash-out is switched off, a value is out of range or doesn't stick, it does nothing and answers ok: false with a
   short reason (no_bet_button, no_auto_cashout, no_stake_input, auto_cashout_off, bad_command, value_not_set).
   It never reads or sends page text, cookies, storage, passwords or tokens. In node it exports act() for the test. */
(function (root, factory) {
  'use strict';
  /* global JetxBetFind */
  var P = factory(typeof JetxBetFind !== 'undefined' ? JetxBetFind : require('./bet-find.js'));
  if (typeof module === 'object' && module && module.exports) { module.exports = P; return; }
  P.install(root);
})(typeof window !== 'undefined' ? window : this, function (F) {
  'use strict';
  var NONCE = /^\d{1,20}$/;

  function valid(cmd) {
    if (!cmd || typeof cmd !== 'object' || !NONCE.test(String(cmd.nonce || ''))) return false;
    if (cmd.cmd === 'probe') return true;
    var t = Number(cmd.target), s = Number(cmd.stake);
    return cmd.cmd === 'bet' && t >= 1.01 && t <= 10000 && s > 0 && s <= 1e7;
  }

  // Sets an input's value the way a typed value arrives (frameworks read the native setter + input/change).
  function setValue(win, el, v) {
    var proto = win && win.HTMLInputElement && win.HTMLInputElement.prototype;
    var d = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    ['input', 'change'].forEach(function (type) {
      try { el.dispatchEvent(new win.Event(type, { bubbles: true })); } catch (e) { /* no events in this frame */ }
    });
  }

  // doc, cmd -> { ok, reason }. The only function that clicks, and only for a valid 'bet' command.
  function act(win, doc, cmd) {
    if (!valid(cmd)) return { ok: false, reason: 'bad_command' };
    var bet = F.findBet(doc), auto = F.findAuto(doc), stake = F.findStake(doc);
    if (!bet) return { ok: false, reason: 'no_bet_button' };
    if (!auto) return { ok: false, reason: 'no_auto_cashout' };
    if (!stake) return { ok: false, reason: 'no_stake_input' };
    if (F.autoOff(auto)) return { ok: false, reason: 'auto_cashout_off' };
    if (cmd.cmd === 'probe') return { ok: true, reason: 'ok' };
    var target = Number(cmd.target).toFixed(2), amount = String(Math.round(Number(cmd.stake) * 100) / 100);
    setValue(win, auto, target);
    setValue(win, stake, amount);
    if (F.numberOf(auto.value) !== Number(target) || F.numberOf(stake.value) !== Number(amount)) {
      return { ok: false, reason: 'value_not_set' };
    }
    bet.click();
    return { ok: true, reason: 'ok' };
  }

  function install(win) {
    var port = win && win.ColonJetXBet, doc = win && win.document;
    if (!port || typeof port.postMessage !== 'function' || !doc) return;
    var send = function (o) { try { port.postMessage(JSON.stringify(o)); } catch (e) { /* app went away */ } };
    port.onmessage = function (e) {
      var cmd = null;
      try { cmd = JSON.parse(String(e && e.data)); } catch (x) { return; }
      if (!cmd || !NONCE.test(String(cmd.nonce || ''))) return;
      var r = act(win, doc, cmd);
      send({ nonce: String(cmd.nonce), ok: r.ok, reason: r.reason, step: cmd.cmd === 'bet' ? 'bet' : 'probe' });
    };
    send({ ready: true });
  }

  return { act: act, valid: valid, install: install };
});
