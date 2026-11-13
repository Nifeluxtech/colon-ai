/* Colon AI · workspace event wiring: one delegated click/submit/keyboard handler set for the chat screen. */

import { login, newChat } from './chat.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { renameConv } from '../actions/rename.js';
import { browseNative } from '../actions/saga-native.js';
import { send, stopStreaming } from '../actions/send-message.js';
import { applySplitWidth, nativeInlineAction, openBrowser, renderEmbed, setLayout, setMobileTab, toggleBrowser }
  from '../components/browser-panel.js';
import { autoGrow, devTemplate, modeMenu, onThreadScroll, scrollBottom, setMode, syncComposer,
  trackComposerHeight } from '../components/composer.js';
import { msgAction } from '../components/message.js';
import { modelMenu, updateHeader } from '../components/model-picker.js';
import { applySidebar, closeDrawer, moreMenu, openDrawer, profileMenu, refreshConvs, toggleSidebar,
  toggleTheme } from '../components/sidebar.js';
import { openAttachment } from '../components/uploads.js';
import { CW } from '../core/cw.js';
import { $, PROMPTS, S, data, isMobile } from '../core/state.js';
import { SPEECH_LANGS } from '../core/voice-client.js';

var C = Colon;

/* Mic: pick the language first (small pop list above the mic), then recording starts. Tapping the mic while
   recording stops it as before. */
function voiceMenu(anchor) {
  if (S.hf && S.hf.active()) return S.hf.stop();
  if (S.media.voiceActive()) return S.media.stopVoice();
  var cur = (S.settings && S.settings.voice && S.settings.voice.lang) || 'en-NG';
  C.menu(anchor, [{ head: 'Speak in' }].concat(SPEECH_LANGS.map(function (l) {
    return { label: l[1], checked: l[0] === cur, onClick: function () {
      if (l[0] !== cur) {
        S.settings.voice = Object.assign({}, S.settings.voice, { lang: l[0] });
        data.saveSettings({ voice: { lang: l[0] } }).catch(function () {});
      }
      S.media.startVoice();
    } };
  })).concat(['-', { label: 'Hands-free conversation', sub: 'Talk, pause, and hear the answer. Tap End to stop.',
    onClick: function () { S.hf.start(); } }]), { label: 'Choose the language you will speak', align: 'right' });
}

/* ================= Events ================= */
function bind() {
  var ta = $('#cw-input');
  ta.addEventListener('input', function () { autoGrow(); syncComposer(); });
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && S.settings && S.settings.enterToSend
      && !('ontouchstart' in window && isMobile())) { e.preventDefault(); if (!S.streaming) send(); }
  });
  ta.addEventListener('paste', function (e) {
    var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) {
      return /^image\//.test(f.type); });
    if (files.length) { e.preventDefault(); S.media.addFiles(files); }
  });
  $('#cw-form').addEventListener('submit', function (e) { e.preventDefault(); if (S.streaming) stopStreaming();
    else send(); });
  var chat = $('.cw-chat');
  ['dragenter', 'dragover'].forEach(function (t) { chat.addEventListener(t, function (e) { if (e.dataTransfer
    && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') > -1) { e.preventDefault(); chat.classList.add(
    'dropping'); } }); });
  ['dragleave', 'drop'].forEach(function (t) { chat.addEventListener(t, function (e) { if (t === 'dragleave'
    && chat.contains(e.relatedTarget)) return; chat.classList.remove('dropping'); }); });
  chat.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault();
    S.media.addFiles(e.dataTransfer.files); } });
  var sc = $('#cw-scroll');
  sc.addEventListener('scroll', onThreadScroll, { passive: true });
  ['wheel', 'touchstart', 'touchmove', 'pointerdown'].forEach(function (t) { sc.addEventListener(t, function () {
    S.userInput = Date.now(); }, { passive: true }); });
  sc.addEventListener('keydown', function (e) { if (/^(PageUp|ArrowUp|Home| )$/.test(e.key)) S.userInput = Date.now();
    });
  trackComposerHeight();
  var q = $('#cw-q');
  q.addEventListener('input', C.debounce(function () { S.q = q.value.trim(); refreshConvs(); }, 180));
  q.addEventListener('keydown', function (e) { if (e.key === 'Escape') { q.value = ''; S.q = ''; refreshConvs();
    q.blur(); } });

  // A site without a favicon: drop the broken image quietly (error events don't bubble, so capture).
  S.el.addEventListener('error', function (e) { var t = e.target; if (t && t.classList && t.classList.contains(
    'cw-source-ico')) t.remove(); }, true);
  S.el.addEventListener('click', function (e) {
    var t = e.target;
    var pr = t.closest('[data-prompt]');
    if (pr) { var p = PROMPTS[Number(pr.getAttribute('data-prompt'))]; S.draftMode = p.mode; updateHeader();
      ta.value = p.prompt; autoGrow(); syncComposer(); ta.focus(); ta.setSelectionRange(ta.value.length,
      ta.value.length); return; }
    var dev = t.closest('[data-dev-chip]'); if (dev) { devTemplate(dev.getAttribute('data-dev-chip')); return; }
    var md = t.closest('[data-mode]'); if (md && md.closest('.cw-welcome-modes')) { setMode(md.getAttribute(
      'data-mode')); return; }
    var cm = t.closest('[data-conv-menu]');
    if (cm) { e.preventDefault(); var c = S.convs.filter(function (x) { return x.id === cm.getAttribute(
      'data-conv-menu'); })[0]; if (c) CW.convMenu(cm, c); return; }
    var copyCode = t.closest('[data-copy-code]');
    if (copyCode) { var code = copyCode.closest('.md-code').querySelector('code').textContent; C.copyText(code).then(
      function () { copyCode.textContent = 'Copied'; copyCode.classList.add('done'); setTimeout(function () {
      copyCode.textContent = 'Copy'; copyCode.classList.remove('done'); }, 1600); }, function () { C.toast(
      'Couldn’t copy.', 'bad'); }); return; }
    var att = t.closest('[data-att-open]'); if (att) { openAttachment(att.getAttribute('data-att-open'),
      att.getAttribute('data-kind'), att.getAttribute('data-name') || ''); return; }
    var link = t.closest('.cw-msg a[href^="http"], .cw-source');
    // Citation chips and web-search sources open in a new tab (target=_blank, rel=noopener), not the panel.
    if (link && (link.closest('.cite') || link.hasAttribute('data-web'))) return;
    if (link && S.settings && S.settings.linksInPanel && !e.ctrlKey && !e.metaKey) { e.preventDefault();
      openBrowser(link.getAttribute('href')); return; }
    var mb = t.closest('[data-msg]'); if (mb) { msgAction(mb); return; }
    if (t.closest('.cw-conv a') && isMobile()) closeDrawer();
    var a = t.closest('[data-a]'); if (!a) return;
    var act = a.getAttribute('data-a');
    var acts = {
      'new': function () { closeDrawer(); newChat(); }, sidebar: toggleSidebar, 'drawer-close': closeDrawer,
      model: function () { modelMenu(a); }, profile: function () { profileMenu(a); }, more: function () { moreMenu(a);
        }, theme: toggleTheme,
      'rename-current': function () { if (S.current) renameConv(S.current); },
      attach: function () { S.media.pick(); }, mic: function () { voiceMenu(a); },
      'mode-menu': function () { modeMenu(a); },
      // AI Browse: in the Android app Saga drives the native panel (it opens at once); elsewhere the web reader.
      'browse-web': function () {
        var v = ta.value.trim();
        if (C.native.hasPanel()) browseNative(v);
        else { var b = openBrowser(null, { panel: true }); if (v) { b.startTask(v);
          C.toast('Saga is browsing. Watch every step in the panel.'); } }
        if (v) { ta.value = ''; autoGrow(); syncComposer(); } },
      browser: toggleBrowser,
      'browser-close': function () { S.browser.full = false; setLayout('none'); },
      'layout-split': function () { S.browser.full = false; setLayout('split'); }, 'layout-embed': function () {
        setLayout('embedded'); },
      'native-collapse': function () { nativeInlineAction(act); }, 'native-full': function () {
        nativeInlineAction(act); }, 'native-close': function () { nativeInlineAction(act); },
      'native-mode': function () { nativeInlineAction(act, a); }, 'native-return': function () {
        nativeInlineAction(act); },
      'embed-collapse': function () { S.browser.collapsed = !S.browser.collapsed; renderEmbed(); },
      'embed-full': function () { S.browser.full = !S.browser.full; S.browser.collapsed = false; renderEmbed();
        document.body.classList.toggle('cw-noscroll', S.browser.full); },
      mtab: function () { setMobileTab(a.getAttribute('data-t')); }, jump: function () { scrollBottom(true); },
      'retry-convs': refreshConvs,
      login: function () { closeDrawer(); login('login'); }, signup: function () { closeDrawer(); login('signup'); }
    };
    if (acts[act]) acts[act]();
  });

  if (typeof C.resizable === 'function') C.resizable($('.cw-resizer'), {
    min: 320, invert: true,
    max: function () { return Math.max(360, $('.cw-body').clientWidth - 380); },
    get: function () { return S.browser.width || $('.cw-split').offsetWidth; },
    set: function (v) { S.browser.width = v; $('.cw-split').style.width = v + 'px'; },
    done: function (v) { localStorage.setItem('colon.splitw', Math.round(v)); }
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', C.debounce(function () { applySidebar(); if (!isMobile()) closeDrawer();
    if (S.browser.layout === 'split' && !isMobile()) applySplitWidth(); }, 120));
  window.addEventListener('offline', function () { C.toast(data.kind === 'local'
    ? 'You’re offline. Chats stay on this device; sources need a connection.' :
    'You’re offline. Colon Saga needs a connection to answer.', 'bad'); });
  window.addEventListener('online', function () { C.toast('Back online.', 'ok'); });
  C.theme.on(function () { var s = S.el && S.el.querySelector('.cw-theme'); if (s) s.setAttribute('aria-pressed',
    C.theme.current() === 'light'); });
}
function onKey(e) {
  if (!S.el || !document.body.contains(S.el)) return;
  var k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'k') { e.preventDefault(); if (isMobile()) openDrawer(); $('#cw-q').focus(); }
  else if (mod && e.shiftKey && k === 'o') { e.preventDefault(); newChat(); }
  else if (k === 'escape' && S.streaming) { stopStreaming(); }
  else if (k === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
    && !document.activeElement.isContentEditable) { e.preventDefault(); $('#cw-input').focus(); }
}

export { bind, onKey };
