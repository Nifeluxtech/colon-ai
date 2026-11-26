/* Colon AI · sticker picker (0.37.0): the smiley in the composer opens a grid of stickers; a tap sends the sticker
   as its own message ([sticker:id], lib/stickers.js) and Colon reacts to it. Also the Fun row in Settings › Chat
   preferences: Auto (Colon follows your vibe, may send stickers) or Off (plain replies, no stickers). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { send } from '../actions/send-message.js';
import { Stickers } from '../lib/stickers.js';
import { $, S } from '../core/state.js';

var C = Colon, esc = C.esc;

function stickerSheet() {
  if (S.streaming) { C.toast('Wait for Colon to finish this reply.'); return; }
  C.sheet('<div class="h2">Stickers</div><div class="cw-sticker-grid" role="list">' + Stickers.LIST.map(function (s) {
    return '<button type="button" class="cw-sticker-pick" role="listitem" data-sticker="' + s[0] + '" aria-label="'
      + esc(s[1]) + '">' + Stickers.imgHtml(s[0]) + '<span>' + esc(s[1]) + '</span></button>';
  }).join('') + '</div>', function (el, close) {
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-sticker]'), ta = $('#cw-input');
      if (!b || !ta) return;
      var keep = ta.value;
      ta.value = Stickers.token(b.getAttribute('data-sticker'));
      close(); send();
      if (keep && !ta.value) ta.value = keep;   // a half-typed message stays in the box
    });
  }, { label: 'Stickers', cls: 'cw-sticker-sheet' });
}

function funRowHtml() {
  return '<label class="set-row"><span class="body"><span class="title">Fun and stickers</span><span class="sub">'
    + 'Auto: Colon gets playful and may send a sticker when you do. Off: plain replies (this device)</span></span>'
    + '<span class="switch"><input type="checkbox" data-fun' + (Stickers.funOn() ? ' checked' : '')
    + ' aria-label="Fun and stickers"><i></i></span></label>';
}
function bindFun(root) {
  var f = root.querySelector('[data-fun]');
  if (f) f.addEventListener('change', function () {
    Stickers.setFun(f.checked); C.toast(f.checked ? 'Fun is on Auto.' : 'Fun is off.', 'ok');
  });
}

export { bindFun, funRowHtml, stickerSheet };
