/* Colon AI · the integrated browser panel (embedded in the thread, split screen, phone tabs). Uses
   ColonBrowser from packages/ui; never its internals. */

import { autoGrow, scrollBottom, syncComposer } from './composer.js';
import { renderThread } from './message.js';
import { updateHeader } from './model-picker.js';
import { refreshConvs } from './sidebar.js';
import { loadCards, placeCards, resized } from './browser-card.js';
import { chatCall, sessionKey } from '../lib/browser-modes.js';
import { createAnchor } from '../lib/native-anchor.js';
import { needsAnnounce, showsCard, withInline } from '../lib/native-panel.js';
import { reveal } from '../lib/thread-scroll.js';
import { ColonBrowser } from '../../../../packages/ui/js/browser/index.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { CW } from '../core/cw.js';
import { $, S, data, defaultModel, isMobile, signedIn } from '../core/state.js';
import { setView } from '../pages/chat.js';

var C = Colon, icon = C.icon;

/* ================= Browser panel ================= */
function ensureBrowser() {
  if (S.browser.inst) return S.browser.inst;
  var holder = document.createElement('div'); holder.className = 'cw-browser-holder';
  // Phase 10: one browser per chat; on the web the reader keeps this conversation's own session.
  S.browser.instKey = sessionKey(S.current);
  S.browser.inst = ColonBrowser.create(holder, {
    variant: 'panel', sessionKey: S.browser.instKey,
    onSummary: function (md, sources, goal) { addBrowseNote(md, sources, goal); },
    onAsk: function (url) { var ta = $('#cw-input'); ta.value = 'Summarise this page for me: ' + url; autoGrow();
      syncComposer(); setMobileTab('chat'); ta.focus(); },
    onNavigateApp: function (section) { if (C.native.openTab('')) return;
      window.open('https://browser.apparatus.name.ng/#/' + section, '_blank', 'noopener'); }
  });
  S.browser.inst.on('change', browserIndicator);
  return S.browser.inst;
}
function browserIndicator() {
  var b = S.browser.inst; if (!b) return; var st = b.state(); if (!st) return;
  var activeTask = st.task && /planning|running|awaiting_approval/.test(st.task.status);
  var dot = $('[data-a=browser] .dot'); dot.hidden = !activeTask;
  S.el.querySelectorAll('[data-bdot]').forEach(function (d) { d.className = 'status-dot' + (activeTask || st.loading
    ? ' live' : '') + (st.task && st.task.status === 'paused' ? ' warn' : ''); });
  var label = st.active ? (/^colon:/.test(st.active.url) ? 'New tab' : ColonURL.displayUrl(st.active.url)) : '';
  S.el.querySelectorAll('[data-burl]').forEach(function (u) { u.textContent = (activeTask ? 'Saga: ' + (st.task.site
    || 'working') + ' · ' : '') + label; });
}
// Inside Colon AI for Android (v0.8.0) the chat's browser is the app's native panel: a real Android WebView beside
// the chat (embedded, split or full screen; the app draws its header, Saga controls and "Open in Colon Browser").
// On the web it is the reader panel (light mode). AI Browse in the app runs on the native panel since v0.9.0
// (actions/saga-native.js: Saga drives the WebView through the server); { panel: true } is the web reader's AI
// Browse, used on the web and as its fallback. An older app without the panel opened a native tab instead.
function openBrowser(url, opts) {
  if (!(opts && opts.panel)) {
    if (C.native.hasPanel()) { nativeBrowser('open', { url: url || '' }).then(syncNative, nativeFailed);
      return null; }
    if (C.native.openTab(url || '')) return null;
  }
  var b = ensureBrowser();
  if (S.browser.layout === 'none') setLayout(isMobile() ? 'embedded' : (S.settings.browserLayout || 'split'));
  else if (S.browser.layout === 'embedded' && S.browser.collapsed) { S.browser.collapsed = false; renderEmbed(); }
  if (S.browser.layout === 'split' && isMobile()) setMobileTab('browser');
  if (url) b.navigate(url);
  return b;
}
function setLayout(l) {
  var b = ensureBrowser(); S.browser.layout = l; S.el.setAttribute('data-layout', l);
  $('[data-a=browser]').setAttribute('aria-pressed', l !== 'none');
  var embedHost = $('.cw-embed-host');
  if (l === 'embedded') { renderEmbed(); b.mount(embedHost.querySelector('.cw-embed-body')); setTimeout(function () {
    revealInThread(embedHost, true); }, 50); }
  else { embedHost.innerHTML = ''; }
  if (l === 'split') { b.mount($('.cw-split-body')); applySplitWidth(); if (isMobile()) setMobileTab('browser'); }
  if (l === 'none') { if (b.el.parentNode) b.el.parentNode.removeChild(b.el); setMobileTab('chat'); }
  if (l !== 'none' && S.settings.browserLayout !== l && !isMobile()) data.saveSettings({ browserLayout: l }).then(
    function (s) { S.settings = s; });
  browserIndicator();
}
function renderEmbed() {
  var host = $('.cw-embed-host'), b = S.browser.inst;
  var existing = host.querySelector('.cw-embed');
  if (!existing) {
    host.innerHTML = (
      '<div class="cw-embed" role="region" aria-label="Colon Browser (embedded)"><div class="cw-embed-head"><span '
      + 'class="status-dot" data-bdot></span><b>Colon Browser</b><span class="tiny muted cw-ellipsis" '
      + 'data-burl></span>') +
      ('<button class="icon-btn sm" data-a="embed-collapse" aria-label="Collapse browser" aria-expanded="true" '
        + 'data-tip="Collapse">') + icon('chevDown') + '</button>' +
      '<button class="icon-btn sm cw-hide-xs" data-a="layout-split" aria-label="Split screen" data-tip="Split screen">'
        + icon('split') + '</button>' +
      '<button class="icon-btn sm" data-a="embed-full" aria-label="Expand to full screen" data-tip="Full screen">'
        + icon('expand') + '</button>' +
      '<button class="icon-btn sm" data-a="browser-close" aria-label="Close browser" data-tip="Close">' + icon('x')
        + '</button></div><div class="cw-embed-body"></div></div>';
    existing = host.querySelector('.cw-embed');
    if (b && b.el.parentNode !== existing.querySelector('.cw-embed-body')) b.mount(existing.querySelector(
      '.cw-embed-body'));
  }
  existing.classList.toggle('collapsed', S.browser.collapsed); existing.classList.toggle('full', S.browser.full);
  var cb = existing.querySelector('[data-a=embed-collapse]'); cb.setAttribute('aria-expanded', !S.browser.collapsed);
    cb.setAttribute('aria-label', S.browser.collapsed ? 'Expand browser' : 'Collapse browser');
  var fb = existing.querySelector('[data-a=embed-full]'); fb.innerHTML = icon(S.browser.full ? 'collapse' : 'expand');
    fb.setAttribute('aria-label', S.browser.full ? 'Exit full screen' : 'Expand to full screen');
  browserIndicator();
}
function setMobileTab(t) {
  S.browser.mtab = t; S.el.setAttribute('data-mtab', t);
  S.el.querySelectorAll('[data-a=mtab]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute(
    'data-t') === t); });
}
function applySplitWidth() {
  var w = S.browser.width || Number(localStorage.getItem('colon.splitw')) || Math.round(($('.cw-body').clientWidth
    || 1000) * 0.45);
  S.browser.width = w; $('.cw-split').style.width = w + 'px';
}
// The conversation this browsing belongs to (a new chat gets one now; its browser is adopted, not replaced).
function ensureConv(mode) {
  if (S.current && !S.loadingConv) return Promise.resolve(S.current);
  return data.createConversation({ mode: mode || S.draftMode || 'research', model: S.draftModel || defaultModel() })
    .then(function (c) { S.current = c; S.messages = []; S.browser.createdId = c.id; history.replaceState(null, '',
      '#/c/' + encodeURIComponent(c.id)); setView('chat'); return c; });
}
// A message in the thread from browsing: Saga's note, or (Phase 10) the user's own browser instruction.
function addThreadNote(content, o) {
  o = o || {};
  return ensureConv(o.mode).then(function (conv) { return data.addNote(conv.id, { content: content, role: o.role,
    sources: o.sources || [], origin: 'browse', title: o.title }); })
    .then(function (m) { S.messages.push(m); renderThread(); scrollBottom(true); refreshConvs(); updateHeader();
      return m; });
}
function addBrowseNote(md, sources, goal, o) {
  addThreadNote(md, { sources: sources, title: goal, mode: 'research' }).then(function () {
    if (!(o && o.quiet)) C.toast('AI Browse summary added to the chat.', 'ok'); setMobileTab('chat'); })
    .catch(function (e) { C.toast(e.message, 'bad'); });
}
/* ---------- Native panel (Android app) ---------- */
// The app's panel state -> the Browser button (pressed while open; dot while loading or while Saga has control).
function syncNative(st) {
  if (!st || typeof st !== 'object') return; S.browser.nativeState = st;
  var btn = $('[data-a=browser]');
  if (btn) { btn.setAttribute('aria-pressed', !!st.open); var dot = btn.querySelector('.dot');
    if (dot) dot.hidden = !(st.open && (st.loading || st.control !== 'manual')); }
  if (S.el) S.el.setAttribute('data-native-browser', st.open ? st.layout + (st.collapsed ? '-collapsed' : '')
    : 'none');
  renderNativeInline(st);
  announceInline(st);
}
// The app hasn't heard (or lost track, after a reload or its fallback) that this page draws the card: say so, and
// the app moves the panel into the thread (v0.9.2, lib/native-panel.js).
function announceInline(st) {
  if (!needsAnnounce(st, { canInline: inlineOk(), pending: S.browser.announcing,
    announced: S.browser.announced })) return;
  S.browser.announcing = true; S.browser.announced = true;
  nativeBrowser('state').then(function (s2) { S.browser.announcing = false; syncNative(s2); },
    function () { S.browser.announcing = false; });
}
function nativeFailed() { C.toast('The browser panel didn’t open. Try again.', 'bad'); }
// The Browser button: opens or closes the native panel in the app, the web panel elsewhere.
function toggleBrowser() {
  if (C.native.hasPanel()) { var open = S.browser.nativeState && S.browser.nativeState.open;
    nativeBrowser(open ? 'close' : 'open').then(syncNative, nativeFailed); return; }
  if (S.browser.layout === 'none') openBrowser(); else setLayout('none');
}
// Follows the panel while the chat is mounted; returns the function that stops following.
function startNativeBrowser() {
  S.browser.host = $('.cw-native-host');
  CW.placeCards = placeCards;                  // message.js redraws the thread: the cards go back in place
  window.addEventListener('resize', resized, { passive: true });
  if (!C.native.hasPanel()) return function () { window.removeEventListener('resize', resized); };
  // The first call says at once that this page draws the inline card (every call does, v0.9.1); the state of a
  // panel the app opened by itself meanwhile comes back with it.
  nativeBrowser('state').then(syncNative, function () {});
  syncChat();                         // Phase 10: the app shows this chat's own browser from the start
  var off = C.native.on('browser', syncNative);
  var offResume = C.native.on('resume', function () { nativeBrowser('state').then(syncNative, function () {}); });
  var offRetry = C.native.on('browserRetry', function (d) { if (CW.sagaRetry) CW.sagaRetry(d); });
  return function () { off(); offResume(); offRetry(); stopAnchor(); window.removeEventListener('resize', resized);
    var h = S.browser.host; if (h) h.innerHTML = ''; };
}
/* ---------- The live card in the thread (v0.9.1 layout "inline"; 0.10.3 Saga's task card, ADR 0006) ---------- */
// This page draws the card's box (components/browser-card.js) and the app lays its real WebView over it (lib/
// native-anchor.js reports where it is), with the status pill, expand and Take control drawn by the app. Every call
// says this page can draw the card ({ inline: true }); older apps keep the panel above the chat.
function inlineOk() { return C.native.can('browserInline'); }
function nativeBrowser(action, o) { return C.native.browser(action, withInline(o, inlineOk())); }
// Brings a card into view by scrolling the thread only (v0.10.1): scrollIntoView() also scrolled the fixed frame,
// the page and the phone's visual viewport, which moved the composer off the bottom of the screen.
function revealInThread(el, smooth) {
  if (el) reveal($('#cw-scroll'), el, { cover: $('.cw-composer'), smooth: !!smooth });
}
function stopAnchor() { if (S.browser.anchor) { S.browser.anchor.stop(); S.browser.anchor = null; } }
function appCards() { return C.native.can('browserCard') ? nativeBrowser('cards') : Promise.resolve([]); }
// The task ended: its card's picture and result are on the phone a moment later.
function followRun(run) {
  var was = S.browser.runState, now = run && run.state;
  S.browser.runState = now;
  if (now && now !== was && /^(done|error|stopped)$/.test(now)) {
    setTimeout(function () { loadCards(sessionKey(S.current), appCards); }, 2400);
  }
}
function renderNativeInline(st) {
  var was = S.browser.liveShown, shows = showsCard(st, inlineOk());
  S.browser.liveShown = shows;
  followRun(st.run);
  placeCards();
  var body = S.browser.host && S.browser.host.querySelector('.cw-native-body');
  if (!shows || !body) { stopAnchor(); return; }
  if (S.browser.anchor && S.browser.anchorEl !== body) stopAnchor();
  if (!S.browser.anchor) {
    S.browser.anchorEl = body;
    S.browser.anchor = createAnchor({ el: body, scroller: $('#cw-scroll'), band: true,
      // The app's WebView is clipped to the band above the floating composer, never over it (v0.10.1).
      // 0.10.2: looked up on every measure (a re-drawn composer still counts) and watched for size changes.
      cover: function () { return $('.cw-composer'); }, watch: [$('#cw-page'), $('.cw-composer')],
      collapsed: function () { return !!(S.browser.nativeState && S.browser.nativeState.collapsed); },
      send: function (p) { nativeBrowser('anchor', p).catch(function () {}); } });
  } else S.browser.anchor.update();
  // A new card, or Saga needs the user: bring it into view once (so its pointer and request can be seen).
  var run = st.run || {}, wants = run.state === 'running' || run.state === 'needs_user';
  if (!was || (wants && S.browser.sagaShown !== run.state)) setTimeout(function () {
    revealInThread(S.browser.host, true); }, 50);
  S.browser.sagaShown = wants ? run.state : null;
}
// Taps in the thread: a finished card brings the live browser back; older pages' header buttons still work.
function nativeInlineAction(act) {
  var st = S.browser.nativeState || {};
  if (act === 'saga-card-open') return nativeBrowser('open').then(syncNative, nativeFailed);
  if (act === 'native-return') return nativeBrowser('control', { op: 'return_to_ai' }).then(syncNative, nativeFailed);
  var call = act === 'native-collapse' ? nativeBrowser('collapse', { collapsed: !st.collapsed })
    : act === 'native-full' ? nativeBrowser('layout', { layout: 'full' }) : nativeBrowser('close');
  call.then(syncNative, nativeFailed);
}
/* ---------- Phase 10: one browser per chat (0.10.3: AI only) ---------- */
// The chat's mode, kept on the conversation for older apps; the in-chat browser is AI-only since 0.10.3.
function setChatMode(mode) {
  if (S.current && !S.loadingConv) {
    S.current.browser_mode = mode;
    data.updateConversation(S.current.id, { browser_mode: mode }).catch(function () {});
  }
  return Promise.resolve();
}
// The chat on screen changed (updateHeader runs on every change): the app shows that chat's browser, a new chat
// gets a clean one (or keeps its draft when its conversation was just created), and the web reader its session.
function syncChat() {
  if (!S.el || (S.view !== 'chat' && S.view !== 'welcome')) return;
  var key = sessionKey(S.current);
  if (S.browser.inst && S.browser.instKey !== key) {
    if (S.browser.layout !== 'none') setLayout('none');
    S.browser.inst.destroy(); S.browser.inst = null;
  }
  // 0.10.3: this chat's Saga cards (the app's, with pictures; on the web, the server's tasks for this chat).
  if (S.browser.cardsKey !== key) {
    S.browser.cardsKey = key; S.browser.cards = [];
    loadCards(key, C.native.hasPanel() ? appCards : signedIn() && data.kind === 'remote' ? null
      : function () { return []; });
  }
  if (!C.native.can('browserChats')) return;
  var call = chatCall(S.browser.chatSent, key, { created: !!key && key === S.browser.createdId });
  if (call) { S.browser.chatSent = key; S.browser.modeSent = null; nativeBrowser('chat', call).then(syncNative,
    function () {}); }
  // AI only (0.10.3); an older app that still has "AI + me" is told so too.
  if (S.browser.modeSent !== key) { S.browser.modeSent = key;
    nativeBrowser('mode', { mode: 'ai' }).then(syncNative, function () {}); }
}
CW.syncChat = syncChat;
// A deleted chat's browser goes with it: the app's profile and tabs, the web reader's session on this device.
function forgetChat(id) {
  if (C.native.can('browserChats')) nativeBrowser('forget', { conversation_id: id }).catch(function () {});
  var d = window.ColonBrowserData && window.ColonBrowserData.get();
  if (d && d.kind === 'local' && d.removeSession) d.removeSession(id).catch(function () {});
}
CW.forgetAllChats = function () {
  if (C.native.can('browserChats')) nativeBrowser('forget', { all: true }).catch(function () {});
};
function applyTextSize() { document.documentElement.setAttribute('data-text', (S.settings && S.settings.textSize)
  || 'md'); }

export { addBrowseNote, addThreadNote, applySplitWidth, applyTextSize, ensureConv, forgetChat, nativeBrowser,
  nativeFailed, nativeInlineAction, openBrowser, renderEmbed, setChatMode, setLayout, setMobileTab, startNativeBrowser,
  syncChat, syncNative, toggleBrowser };
