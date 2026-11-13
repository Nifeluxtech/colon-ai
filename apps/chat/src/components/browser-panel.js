/* Colon AI · the integrated browser panel (embedded in the thread, split screen, phone tabs). Uses
   ColonBrowser from packages/ui; never its internals. */

import { autoGrow, scrollBottom, syncComposer } from './composer.js';
import { renderThread } from './message.js';
import { updateHeader } from './model-picker.js';
import { refreshConvs } from './sidebar.js';
import { createAnchor } from '../lib/native-anchor.js';
import { needsAnnounce, showsCard, withInline } from '../lib/native-panel.js';
import { ColonBrowser } from '../../../../packages/ui/js/browser/index.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { $, S, data, defaultModel, isMobile } from '../core/state.js';
import { setView } from '../pages/chat.js';

var C = Colon, icon = C.icon;

/* ================= Browser panel ================= */
function ensureBrowser() {
  if (S.browser.inst) return S.browser.inst;
  var holder = document.createElement('div'); holder.className = 'cw-browser-holder';
  S.browser.inst = ColonBrowser.create(holder, {
    variant: 'panel',
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
    embedHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 50); }
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
function addBrowseNote(md, sources, goal) {
  var c = S.current && !S.loadingConv ? Promise.resolve(S.current) : data.createConversation({ mode: 'research',
    model: S.draftModel || defaultModel() }).then(function (c) { S.current = c; S.messages = []; history.replaceState(
    null, '', '#/c/' + encodeURIComponent(c.id)); setView('chat'); return c; });
  c.then(function (conv) { return data.addNote(conv.id, { content: md, sources: sources, origin: 'browse',
    title: goal }); })
    .then(function (m) { S.messages.push(m); renderThread(); scrollBottom(true); refreshConvs(); updateHeader();
      C.toast('AI Browse summary added to the chat.', 'ok'); setMobileTab('chat'); })
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
  if (!C.native.hasPanel()) return function () {};
  // The first call says at once that this page draws the inline card (every call does, v0.9.1); the state of a
  // panel the app opened by itself meanwhile comes back with it.
  nativeBrowser('state').then(syncNative, function () {});
  var off = C.native.on('browser', syncNative);
  var offResume = C.native.on('resume', function () { nativeBrowser('state').then(syncNative, function () {}); });
  return function () { off(); offResume(); stopAnchor(); var h = $('.cw-native-host'); if (h) h.innerHTML = ''; };
}
/* ---------- Native panel inside the thread (v0.9.1, layout "inline") ---------- */
// Since Colon AI 0.9.1 (feature "browserInline") the phone's panel can sit in the thread where the web card sits:
// this page draws the card's header and an empty body box, and the app lays its real WebView over that box
// (lib/native-anchor.js reports where it is). Every call says this page can draw the card ({ inline: true }), so
// the app uses "inline" only with a page that can; older pages and older apps keep the panel above the chat.
function inlineOk() { return C.native.can('browserInline'); }
function nativeBrowser(action, o) { return C.native.browser(action, withInline(o, inlineOk())); }
function stopAnchor() { if (S.browser.anchor) { S.browser.anchor.stop(); S.browser.anchor = null; } }
function inlineHtml() {
  return '<div class="cw-embed cw-native-card" role="region" aria-label="Colon Browser (in the chat)">'
    + '<div class="cw-embed-head"><span class="status-dot" data-ndot></span><b>Colon Browser</b>'
    + '<span class="tiny muted cw-ellipsis" data-nurl></span>'
    + '<button class="icon-btn sm" data-a="native-collapse" aria-label="Collapse browser" aria-expanded="true" '
    + 'data-tip="Collapse">' + icon('chevDown') + '</button>'
    + '<button class="icon-btn sm" data-a="native-full" aria-label="Expand to full screen" data-tip="Full screen">'
    + icon('expand') + '</button>'
    + '<button class="icon-btn sm" data-a="native-close" aria-label="Close browser" data-tip="Close">' + icon('x')
    + '</button></div><div class="cw-embed-body cw-native-body"><span class="tiny muted">Loading the page…</span>'
    + '</div></div>';
}
function renderNativeInline(st) {
  var host = $('.cw-native-host'); if (!host) return;
  if (!showsCard(st, inlineOk())) { stopAnchor(); host.innerHTML = ''; return; }
  var card = host.querySelector('.cw-native-card'), fresh = !card;
  if (fresh) { host.innerHTML = inlineHtml(); card = host.querySelector('.cw-native-card'); }
  card.classList.toggle('collapsed', !!st.collapsed);
  var saga = st.control && st.control !== 'manual';
  card.querySelector('[data-ndot]').className = 'status-dot' + (saga || st.loading ? ' live' : '')
    + (st.paused ? ' warn' : '');
  card.querySelector('[data-nurl]').textContent = (saga ? 'Saga · ' : '') + (st.url ? ColonURL.displayUrl(st.url)
    : 'New tab');
  var cb = card.querySelector('[data-a=native-collapse]');
  cb.setAttribute('aria-expanded', !st.collapsed);
  cb.setAttribute('aria-label', st.collapsed ? 'Expand browser' : 'Collapse browser');
  if (!S.browser.anchor) {
    S.browser.anchor = createAnchor({ el: card.querySelector('.cw-native-body'), scroller: $('#cw-scroll'),
      watch: [$('#cw-page')], collapsed: function () { return !!(S.browser.nativeState
        && S.browser.nativeState.collapsed); },
      send: function (p) { nativeBrowser('anchor', p).catch(function () {}); },
      // The keyboard opened while the chat's own fields aren't focused: it is for the page in the panel, so keep
      // the card's box on screen (the thread shrank and could have hidden what is typed).
      onKeyboard: function () { var f = document.activeElement;
        if (!f || !/^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)) {
          card.querySelector('.cw-native-body').scrollIntoView({ block: 'nearest' }); } } });
  } else S.browser.anchor.update();
  if (fresh) setTimeout(function () { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 50);
}
// The card's header buttons: collapse / expand, full screen (the app's own header there), close.
function nativeInlineAction(act) {
  var st = S.browser.nativeState || {};
  var call = act === 'native-collapse' ? nativeBrowser('collapse', { collapsed: !st.collapsed })
    : act === 'native-full' ? nativeBrowser('layout', { layout: 'full' }) : nativeBrowser('close');
  call.then(syncNative, nativeFailed);
}
function applyTextSize() { document.documentElement.setAttribute('data-text', (S.settings && S.settings.textSize)
  || 'md'); }

export { addBrowseNote, applySplitWidth, applyTextSize, nativeBrowser, nativeFailed, nativeInlineAction, openBrowser,
  renderEmbed, setLayout, setMobileTab, startNativeBrowser, syncNative, toggleBrowser };
