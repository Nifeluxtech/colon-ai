/* Colon AI · the new chat's welcome (0.24.0): the intro animation (lib/welcome-intro.js chooses play or poster),
   then "What can we explore today?". The four shortcuts and the Study / Developer / Research chips sit in the
   composer right above the message box (components/composer.js), so they stay pinned there with the keyboard open. */

import { renderModeChips } from './composer.js';
import { bindNotice, noticeBanner } from './notice.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { $, S } from '../core/state.js';
import { WelcomeIntro } from '../lib/welcome-intro.js';

var C = Colon;

function renderWelcome() {
  var page = $('#cw-page'); page.className = 'cw-page cw-page-welcome';
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var how = WelcomeIntro.introMode({ reducedMotion: reduce, played: S.introPlayed,
    saveData: !!(navigator.connection && navigator.connection.saveData) });
  page.innerHTML = noticeBanner() + (typeof C.verifyBanner === 'function' ? C.verifyBanner() : '')
    + '<section class="cw-welcome">' +
    '<div class="cw-intro" data-intro="' + how + '" aria-hidden="true"><img class="cw-intro-poster" src="'
      + WelcomeIntro.POSTER + '" alt="" width="507" height="337" decoding="async"></div>' +
    '<h1 class="cw-hero-h">What can we explore today?</h1>' +
    '<p class="cw-hero-p">Your ideas, questions and ambitions start here.</p></section>';
  if (typeof C.bindBanner === 'function') C.bindBanner(page);
  bindNotice(page);
  renderModeChips();  // the chips sit in the composer, between the shortcut list and the message box
  if (how === 'play') { S.introPlayed = true; playIntro(page.querySelector('.cw-intro')); }
}
// The poster (the last frame, 17 KB) paints first, dimmed; after that paint the animated WebP loads, plays once
// over it (its loop count is 1) and is then removed, leaving the identical poster. A slow or failed load just
// shows the poster.
function playIntro(box) {
  var done = false, img = new Image(), wait;
  function finish() { if (done) return; done = true; clearTimeout(wait); box.classList.remove('playing');
    box.setAttribute('data-intro', 'poster'); setTimeout(function () { if (img.parentNode) img.remove(); }, 400); }
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    if (!box.isConnected) return;
    wait = setTimeout(finish, 4000);
    img.className = 'cw-intro-anim'; img.alt = ''; img.decoding = 'async';
    img.onload = function () { if (done || !box.isConnected) return; clearTimeout(wait); box.appendChild(img);
      box.classList.add('playing'); wait = setTimeout(finish, WelcomeIntro.PLAY_MS); };
    img.onerror = finish;
    img.src = WelcomeIntro.SRC;
  }); });
}

export { renderWelcome };
