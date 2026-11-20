/* Colon AI · phone control from the chat (Colon OS Assistant, Step 2; docs/os-assistant/step-2.md). In the Android
   app (feature "phone"), a message that is a phone command (lib/phone-intent.js) runs on the phone instead of going
   to the chat model: the app checks it against its allowlist (PhoneRules.kt) and acts (PhoneActions.kt). The answer
   is a toast, and in hands-free it is spoken before Colon listens again; a command that leaves Colon (an app, the
   dialler, Messages, Maps, the camera, a settings screen) ends hands-free first. "open <name>" with no app of that
   name on the phone goes on as an ordinary message (fallback), so "open google.com" and chat still work. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { S } from '../core/state.js';
import { SITES } from '../lib/browser-intent.js';
import { parsePhone, phoneError } from '../lib/phone-intent.js';

var LEAVES = ['open_app', 'settings', 'dial', 'sms', 'navigate', 'camera'];

function handsFree() { return !!(S.hf && S.hf.active()); }

function finish(say, ok, leaves) {
  Colon.toast(say, ok ? 'ok' : 'bad');
  Colon.native.haptic(ok ? 'confirm' : 'reject');
  if (!handsFree()) return;
  if (leaves && ok) S.hf.stop();
  else S.hf.replyDone({ status: 'complete' }, say);
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
  if (cmd.action === 'unsupported') { finish(cmd.say, false, false); return true; }
  var args = Object.assign({}, cmd); delete args.soft; delete args.app;
  Colon.native.call('phone', args).then(function (r) {
    finish((r && r.say) || 'Done.', true, LEAVES.indexOf(cmd.action) >= 0);
  }, function (e) {
    var code = e && e.code;
    if (cmd.soft && code === 'not_found') { fallback(); return; }
    finish(phoneError(code), false, false);
  });
  return true;
}

export { handlePhoneText };
