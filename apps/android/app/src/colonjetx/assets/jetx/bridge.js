/* Colon JetX for Android (0.34.0, Crash Predictor step 2; collector 0.35.0): window.ColonJetX in the predictor pane.
   Injected at document start by JetxBridge.kt, only into https://crash.apparatus.name.ng (main frame); WebView
   supplies window.ColonJetXNative there and nowhere else. Never injected into the betting site.
     ColonJetX.call(cmd, args) -> Promise   commands: ready, status, openSite { url? }, setLayout { layout },
                                            setCollector { on }
     ColonJetX.on(event, fn) -> off()       events: session { status, host }, mode { mode }, layout { layout },
                                            collector { on, status, rounds_today, last_multiplier }
   The page also hears a 'colonjetx' DOM event on window once the bridge is ready (detail: the status). */
(function () {
  'use strict';
  var port = window.ColonJetXNative;
  if (window.ColonJetX || !port || window.top !== window) return;
  var seq = 0, waiting = {}, handlers = {};

  port.onmessage = function (e) {
    var m;
    try { m = JSON.parse(e.data); } catch (x) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.event) {
      (handlers[m.event] || []).slice().forEach(function (fn) { try { fn(m.data); } catch (x) { /* page's own */ } });
      return;
    }
    var w = waiting[m.id];
    if (!w) return;
    delete waiting[m.id];
    if (m.ok) w.ok(m.result); else w.no(new Error(m.error || 'failed'));
  };

  function call(cmd, args) {
    return new Promise(function (ok, no) {
      var id = ++seq;
      waiting[id] = { ok: ok, no: no };
      port.postMessage(JSON.stringify({ id: id, cmd: String(cmd), args: args || {} }));
    });
  }

  function on(event, fn) {
    (handlers[event] = handlers[event] || []).push(fn);
    return function () { handlers[event] = (handlers[event] || []).filter(function (f) { return f !== fn; }); };
  }

  window.ColonJetX = Object.freeze({ version: 1, call: call, on: on });
  call('ready').then(function (status) {
    try { window.dispatchEvent(new CustomEvent('colonjetx', { detail: status })); } catch (x) { /* old WebView */ }
  }, function () {});
})();
