/* Colon AI · phone control from the chat (Colon OS Assistant, Step 2; docs/os-assistant/step-2.md). In the Android
   app (feature "phone"), a message that is a phone command (lib/phone-intent.js) runs on the phone instead of going
   to the chat model: the app checks it against its allowlist (PhoneRules.kt) and acts (PhoneActions.kt).
   0.22.1: the command and Colon's reply ("take me to WhatsApp" -> "I'll take you to WhatsApp now.") go in the chat
   thread and its history (actions/command-thread.js, wordings in lib/command-replies.js); in voice mode the reply
   is spoken, and a command that leaves Colon (an app, the dialler, Messages, Maps, the camera, a settings screen)
   ends voice mode after saying it. "open <name>" with no app of that name goes on as an ordinary message
   (fallback), so "open google.com" and chat still work, unless it is an app Colon knows or the user said "app"
   or is talking (then: "I couldn't find WhatsApp on this phone."). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { S } from '../core/state.js';
import { SITES } from '../lib/browser-intent.js';
import { knownApp, reply } from '../lib/command-replies.js';
import { parsePhone, phoneError } from '../lib/phone-intent.js';
import { answer, commandLine } from './command-thread.js';

var LEAVES = ['open_app', 'settings', 'dial', 'sms', 'navigate', 'camera'];

function handsFree() { return !!(S.hf && S.hf.active()); }

/** Colon's words for a command that worked (r: what the phone answered: say, label). */
function okWords(cmd, r) {
  var d = Object.assign({}, cmd, r || {});
  if (cmd.action === 'volume') return reply('volume', { say: (r && r.say) || 'Done.' });
  return reply(cmd.action, d);
}

/**
 * The composer's text before it is sent: true when it was a phone command (handled here), false for anything else.
 * fallback() runs the usual path later when an "open <name>" finds no app of that name.
 */
function handlePhoneText(text, fallback) {
  if (!Colon.native.can('phone')) return false;
  var cmd = parsePhone(text);
  if (!cmd) return false;
  // "open youtube" in the chat has opened the site in this chat's browser since 0.10: keep that unless the user
  // said "app" or is talking hands-free (then the phone's own app is what they mean).
  if (cmd.action === 'open_app' && !cmd.app && !handsFree()
    && Object.prototype.hasOwnProperty.call(SITES, cmd.name)) return false;
  if (cmd.action === 'unsupported') {
    commandLine(text); answer(cmd.say, { ok: false }); return true;
  }
  var args = Object.assign({}, cmd); delete args.soft; delete args.app;
  var sure = !cmd.soft || cmd.app || handsFree() || knownApp(cmd.name);
  if (sure) commandLine(text);   // a soft "open <name>" waits: it may turn out to be a chat message
  Colon.native.call('phone', args).then(function (r) {
    if (!sure) commandLine(text);
    answer(okWords(cmd, r), { ok: true, ends: LEAVES.indexOf(cmd.action) >= 0 });
  }, function (e) {
    var code = e && e.code;
    if (!sure && code === 'not_found') { fallback(); return; }
    if (!sure) commandLine(text);
    answer(code === 'not_found' && cmd.action === 'open_app' ? reply('open_app_missing', cmd)
      : phoneError(code), { ok: false });
  });
  return true;
}

export { handlePhoneText };
