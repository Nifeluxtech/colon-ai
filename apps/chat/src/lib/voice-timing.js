/* Colon AI · voice mode timings (0.22.1). One turn's marks: listen (the page asked for the mic), ready (the phone's
   recognizer is ready for speech), speechEnd (the final words), firstToken (the first streamed reply text, or a
   local command's reply), firstAudio (the phone started speaking). summary() gives the numbers against the budgets
   in docs/os-assistant/voice-ui.md (mic ready < 300 ms, local command reply < 500 ms after speech ends, chat first
   audio < 2 s); the chat page logs it to the console and, in the Android app, to logcat (tag ColonVoice) through
   voice_ui. Pure: tested in packages/ui/test/voice-timing.test.js. createTiming(now) -> { mark, summary, reset } */

var BUDGET = { micReady: 300, localReply: 500, firstAudio: 2000 };

function createTiming(now) {
  var clock = now || function () { return Date.now(); }, t = {};
  function reset() { t = {}; }
  function mark(name) { if (t[name] === undefined) t[name] = clock(); return t[name]; }
  function gap(a, b) { return t[a] !== undefined && t[b] !== undefined ? Math.max(0, t[b] - t[a]) : null; }
  /** { micReady, firstToken, firstAudio, local, line, over: [names over budget] } (ms, null when not reached). */
  function summary(local) {
    var s = { micReady: gap('listen', 'ready'), firstToken: gap('speechEnd', 'firstToken'),
      firstAudio: gap('speechEnd', 'firstAudio'), local: !!local, over: [] };
    if (s.micReady !== null && s.micReady > BUDGET.micReady) s.over.push('micReady');
    var reply = local ? s.firstToken : s.firstAudio, budget = local ? BUDGET.localReply : BUDGET.firstAudio;
    if (reply !== null && reply > budget) s.over.push(local ? 'localReply' : 'firstAudio');
    var f = function (v) { return v === null ? '–' : v + ' ms'; };
    s.line = 'voice timing: mic ready ' + f(s.micReady) + ' · speech end → ' + (local ? 'local reply ' : 'first token ')
      + f(s.firstToken) + ' · first audio ' + f(s.firstAudio) + (s.over.length ? ' · over budget: '
      + s.over.join(', ') : '');
    return s;
  }
  return { mark: mark, summary: summary, reset: reset };
}

export { BUDGET, createTiming };
