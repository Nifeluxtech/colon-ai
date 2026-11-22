/* Colon AI · Settings › Voice › "Hey Colon" (0.23.0, OS Assistant Step 5). Only in the Android app with the wake
   word built in (feature "wake_word"): an opt-in switch (off by default, kept on the phone), "Pause on battery
   saver", and a status line from the app (listening, or why it is paused). The app asks for the microphone when
   it is switched on; listening runs in a foreground service with its own notification and Stop button. */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, esc = C.esc;

var STATUS = {
  listening: 'Listening for “Hey Colon”.', starting: 'Starting…', off: 'Off.',
  call: 'Paused during the call.', colon: 'Paused while Colon listens.', heard: 'Paused while Colon listens.',
  mic_busy: 'Paused: another app is using the microphone.', battery: 'Paused: battery saver is on.',
  no_permission: 'Paused: allow the microphone for Colon AI.', no_engine: 'The wake word couldn’t start on this '
    + 'phone.'
};

function available() { return !!(C.native && C.native.can && C.native.can('wake_word')); }

function sw(attr, label, sub) {
  return '<label class="set-row"><span class="body"><span class="title">' + esc(label) + '</span><span class="sub"'
    + (attr === 'data-wake-on' ? ' data-wake-status' : '') + '>' + esc(sub) + '</span></span><span class="switch">'
    + '<input type="checkbox" ' + attr + ' aria-label="' + esc(label) + '"><i></i></span></label>';
}

/** The rows, or '' outside the app. Filled in by bindWakeWordSettings. */
function wakeWordSettingsHtml() {
  if (!available()) return '';
  return sw('data-wake-on', 'Hey Colon', 'Say “Hey Colon” to start talking, even with the screen off. Off until '
    + 'you turn it on; the microphone is used on the phone only and a notification shows while it listens.')
    + sw('data-wake-saver', 'Pause on battery saver', 'Stop listening for “Hey Colon” while battery saver is on.');
}

function statusText(s) {
  if (!s.on) return 'Off. Say “Hey Colon” to start talking, even with the screen off.';
  var t = STATUS[s.state === 'paused' ? s.reason : s.state] || STATUS.starting;
  // 0.24.4: the engine's own error, and while listening the mic level and how often it heard "Hey Colon".
  if (s.state === 'paused' && s.reason === 'no_engine' && s.error) t += ' (' + s.error + ')';
  if (s.state === 'listening' && typeof s.level === 'number') {
    t += ' Mic level ' + s.level + '%' + (s.level < 5 ? ' (quiet: speak closer)' : '') + ', heard ' + (s.heard || 0)
      + (s.heard === 1 ? ' time.' : ' times.');
  }
  return t;
}

function bindWakeWordSettings(root) {
  var on = root.querySelector('[data-wake-on]'), saver = root.querySelector('[data-wake-saver]');
  var line = root.querySelector('[data-wake-status]');
  if (!on || !saver) return;
  function show(s) { on.checked = !!s.on; saver.checked = s.pauseOnSaver !== false; line.textContent = statusText(s); }
  function call(args) { return C.native.call('wake_word', args).then(show); }
  call({ action: 'status' }).catch(function () { line.textContent = 'Not available right now.'; });
  // 0.24.4: keep the status live while Settings › Voice is open (it stops once the page is gone).
  var poll = setInterval(function () {
    if (!root.isConnected) { clearInterval(poll); return; }
    if (!document.hidden && !on.disabled) C.native.call('wake_word', { action: 'status' }).then(show, function () {});
  }, 1000);
  on.addEventListener('change', function () {
    var want = on.checked; on.disabled = true;
    call({ action: 'set', on: want }).then(function () {
      C.toast(want ? 'Hey Colon is on.' : 'Hey Colon is off.', 'ok');
      if (want) setTimeout(function () { call({ action: 'status' }).catch(function () {}); }, 1500);
    }, function (e) {
      on.checked = false;
      C.toast(e && e.code === 'denied' ? 'Colon needs the microphone for “Hey Colon”.' : 'Couldn’t change it.', 'bad');
    }).then(function () { on.disabled = false; });
  });
  saver.addEventListener('change', function () {
    call({ action: 'set', pauseOnSaver: saver.checked }).catch(function () { C.toast('Couldn’t change it.', 'bad'); });
  });
}

export { bindWakeWordSettings, statusText, wakeWordSettingsHtml };
