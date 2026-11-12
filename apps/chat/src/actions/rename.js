/* Colon AI · conversation changes: rename, pin/archive (patch) and share. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { updateHeader } from '../components/model-picker.js';
import { refreshConvs } from '../components/sidebar.js';
import { CW } from '../core/cw.js';
import { S, data } from '../core/state.js';

var C = Colon;

// Share link: anyone with it can read the chat (not your files). Copied straight away; can be turned off.
function shareConv(c, after) {
  data.share(c.id).then(function (sh) {
    c.shared = true; if (S.current && S.current.id === c.id) S.current.shared = true;
    var stop = { label: 'Stop sharing', fn: function () { data.unshare(c.id).then(function () { c.shared = false;
      C.toast('Sharing turned off. The old link no longer works.'); refreshConvs(); }).catch(function (e) { C.toast(
      e.message, 'bad'); }); } };
    C.copyText(sh.url).then(function () { C.toast('Share link copied. Anyone with it can read this chat.', 'ok', stop);
      }, function () {
      C.prompt({ title: 'Share link', label: 'Copy this link', value: sh.url, confirm: 'Done', max: 300 });
    });
    refreshConvs(); if (after) after();
  }).catch(function (e) { C.toast(e.message, 'bad'); });
}
CW.shareConv = shareConv;
function patchConv(c, patch, msg, after) {
  data.updateConversation(c.id, patch).then(function (n) {
    if (S.current && S.current.id === c.id) { S.current = Object.assign(S.current, n); updateHeader();
      if (patch.archived) C.go('/'); }
    C.toast(msg, 'ok'); refreshConvs(); if (after) after();
  }).catch(function (e) { C.toast(e.message, 'bad'); });
}
function renameConv(c, after) {
  C.prompt({ title: 'Rename conversation', label: 'Title', value: c.title, max: 80 }).then(function (v) { if (v
    && v !== c.title) patchConv(c, { title: v }, 'Renamed.', after); });
}

export { patchConv, renameConv, shareConv };
