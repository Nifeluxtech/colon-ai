/* Colon AI · composer: message box, send/stop button, mode chips and menu, thread scrolling. */

import { renderThread } from './message.js';
import { updateHeader } from './model-picker.js';
import { refreshConvs } from './sidebar.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { $, MODES, S, data, isMobile, mode } from '../core/state.js';
import { disclaimer } from '../pages/chat.js';

var C = Colon, icon = C.icon;

function composerHtml() {
  // Floating composer: a pill that hovers above the bottom edge; the thread scrolls underneath it.
  return ('<div class="cw-composer"><button type="button" class="cw-jump btn sm" data-a="jump" hidden '
    + 'aria-label="Jump to latest message">') + icon('chevDown') + 'Latest</button><div class="cw-composer-in">' +
    '<div class="att-tray" hidden aria-label="Attachments"></div>' +
    '<div class="cv-voice" hidden></div>' +
    '<form class="cw-input" id="cw-form" novalidate>' +
      '<button type="button" class="icon-btn" data-a="attach" aria-label="Attach files" data-tip="Attach files">'
        + icon('clip') + '</button>' +
      ('<button type="button" class="cw-mode-btn" data-a="mode-menu" aria-haspopup="menu" aria-label="Mode: '
        + 'General" data-tip="Mode"></button>') +
      ('<textarea id="cw-input" rows="1" maxlength="16000" enterkeyhint="send" aria-label="Message Colon" '
        + 'placeholder="Ask Colon anything…"></textarea>') +
      ('<button type="button" class="icon-btn" data-a="mic" aria-label="Voice input" aria-pressed="false" '
        + 'data-tip="Voice input">') + icon('mic') + '</button>' +
      '<button type="submit" class="cw-send" data-a="send" aria-label="Send message" disabled>' + icon('send')
        + '</button>' +
    '</form>' +
    '<div class="cw-pills" aria-label="Quick actions"><button type="button" class="chip sm" data-a="attach">' + icon(
      'clip') + 'Attach File</button><button type="button" class="chip sm" data-a="mic">' + icon('mic')
      + 'Voice Input</button><button type="button" class="chip sm" data-a="browse-web">' + icon('globe')
      + 'Browse the Web</button></div>' +
    '<p class="cw-disclaimer">' + disclaimer() + '</p>' +
    '</div></div>';
}
function renderModeChips() {
  var m = mode(), box = $('.cw-welcome-modes');
  if (!box) return;  // the chips live on the welcome screen; in a chat the mode button in the pill takes over
  box.innerHTML = ['study', 'developer', 'research'].map(function (k) {
    return '<button type="button" class="chip" role="radio" aria-checked="' + (m === k) + '" data-mode="' + k + '">'
      + icon(MODES[k].icon) + MODES[k].label + '</button>';
  }).join('');
}
function setMode(k) {
  var next = mode() === k ? 'general' : k;
  if (S.current && !S.loadingConv) {
    var prev = S.current.mode; S.current.mode = next; updateHeader();
    data.updateConversation(S.current.id, { mode: next }).then(function (c) {
      S.current = Object.assign(S.current, c);
      if (S.messages.length) { S.messages.push({ id: C.uid('e'), role: 'event', content: 'Switched to ' + next
        + ' mode', created_at: new Date().toISOString() }); renderThread(); scrollBottom(); }
      refreshConvs();
    }).catch(function (e) { S.current.mode = prev; updateHeader(); C.toast(e.message, 'bad'); });
  } else { S.draftMode = next; updateHeader(); }
  C.toast(next === 'general' ? 'General mode' : MODES[next].label + ' mode on. Your chat history stays.');
}

function setModeTo(k) { if (mode() !== k) setMode(k); }
function modeMenu(anchor) {
  var m = mode();
  C.menu(anchor, [{ head: 'Mode' }].concat(['general', 'study', 'developer', 'research'].map(function (k) {
    return { label: MODES[k].label, sub: MODES[k].sub, icon: MODES[k].icon, checked: m === k, onClick: function () {
      setModeTo(k); } };
  })).concat(['-', { label: 'Browse the Web', sub: 'Let Saga browse for you', icon: 'globe', onClick: function () {
    S.el.querySelector('.cw-pills [data-a=browse-web]').click(); } }]), { label: 'Mode', sheetOnMobile: true });
}

/* ================= Composer ================= */
function autoGrow() { var ta = $('#cw-input'); if (!ta.value) { ta.style.height = ''; ta.classList.remove('scrolling');
  return; } ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, isMobile() ? 140 : 220) + 'px';
  ta.classList.toggle('scrolling', ta.scrollHeight > (isMobile() ? 140 : 220)); }
function syncComposer() {
  if (!S.el || !S.media) return;
  var ta = $('#cw-input'), st = S.media.state(), btn = $('[data-a=send]');
  if (S.streaming) { btn.disabled = false; btn.classList.add('stop'); btn.innerHTML = icon('stop');
    btn.setAttribute('aria-label', 'Stop generating'); btn.type = 'button'; }
  else { btn.classList.remove('stop'); btn.innerHTML = icon('send'); btn.setAttribute('aria-label', st.uploading
    ? 'Waiting for uploads' : 'Send message'); btn.type = 'submit'; btn.disabled = st.uploading || (!ta.value.trim()
    && !st.ready); }
  S.el.classList.toggle('has-text', !!ta.value.trim());
}
// Follow the stream only while the reader is at the bottom; once they scroll up, stay put and offer "Latest".
function scrollBottom(force) {
  var sc = $('#cw-scroll'); if (!sc) return;
  if (force) S.stick = true;
  if (S.stick) { sc.scrollTop = sc.scrollHeight; S.lastTop = sc.scrollTop; }
  syncJump();
}
function syncJump() { var j = $('[data-a=jump]'); if (j) j.hidden = S.stick || S.view !== 'chat'; }
function onThreadScroll() {
  var sc = $('#cw-scroll'), dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
  var up = sc.scrollTop < S.lastTop - 1, byUser = Date.now() - S.userInput < 1200;
  S.lastTop = sc.scrollTop;
  if (up && byUser && dist > 8) S.stick = false; else if (dist < 64) S.stick = true;
  syncJump();
}
function trackComposerHeight() {
  // The thread scrolls under the floating composer: pad it by the composer's live height.
  var comp = $('.cw-composer'), chat = $('.cw-chat');
  function upd() { chat.style.setProperty('--composer-h', Math.ceil(comp.offsetHeight) + 'px'); }
  if (window.ResizeObserver) { S.ro = new ResizeObserver(function () { var keep = S.stick; upd();
    if (keep) scrollBottom(); }); S.ro.observe(comp); }
  upd();
}

export { autoGrow, composerHtml, modeMenu, onThreadScroll, renderModeChips, scrollBottom, setMode, syncComposer,
  syncJump, trackComposerHeight };
