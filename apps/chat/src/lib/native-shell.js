/* Colon AI · inside the Android app (v0.7.1). Text, links and images shared to Colon from other apps
   ("Share → Colon AI") land in the message box and the upload tray, ready to ask about. The app holds the
   shared content until the chat asks for it (ColonNative.takeShare), so nothing is lost while the page loads. */

import { autoGrow, syncComposer } from '../components/composer.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { $, S } from '../core/state.js';

function applyShare(p) {
  if (!p) return;
  var N = Colon.native, ta = $('#cw-input'); if (!ta) return;
  var text = N.shareText(p);
  if (text) { ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '\n') + text : text; autoGrow(); syncComposer(); }
  var files = (p.files || []).map(N.fileOf).filter(Boolean);
  if (files.length && S.media) S.media.addFiles(files);
  if (p.skipped) Colon.toast(p.skipped === 1 ? 'One shared item couldn’t be added (images up to 10 MB, 5 at a time).'
    : p.skipped + ' shared items couldn’t be added (images up to 10 MB, 5 at a time).', 'bad');
  else Colon.toast('Shared to Colon AI. Add your question and send.', 'ok');
  N.haptic('confirm');
  ta.focus();
}

// Starts listening for shares; returns the function that stops it (called when the chat unmounts).
function startNativeShell() {
  var N = Colon.native, off = function () {}, stopped = false;
  if (!N.isShell()) return off;
  N.ready().then(function (b) {
    if (!b || stopped) return;
    var take = function () { b.takeShare().then(applyShare, function () {}); };
    take(); off = b.on('share', take);
  });
  return function () { stopped = true; off(); };
}

export { applyShare, startNativeShell };
