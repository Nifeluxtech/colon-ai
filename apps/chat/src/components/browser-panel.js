/* Colon AI · the integrated browser panel (embedded in the thread, split screen, phone tabs). Uses
   ColonBrowser from packages/ui; never its internals. */

import { autoGrow, scrollBottom, syncComposer } from './composer.js';
import { renderThread } from './message.js';
import { updateHeader } from './model-picker.js';
import { refreshConvs } from './sidebar.js';
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
// On the web it is the reader panel (light mode). AI Browse ({ panel: true }) still runs in the web panel until
// Saga drives the native WebView (Phase 9). An older app without the panel opened a native tab instead.
function openBrowser(url, opts) {
  if (!(opts && opts.panel)) {
    if (C.native.hasPanel()) { C.native.browser('open', { url: url || '' }).then(syncNative, nativeFailed);
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
  var btn = $('[data-a=browser]'); if (!btn) return; btn.setAttribute('aria-pressed', !!st.open);
  var dot = btn.querySelector('.dot'); if (dot) dot.hidden = !(st.open && (st.loading || st.control !== 'manual'));
  S.el.setAttribute('data-native-browser', st.open ? st.layout + (st.collapsed ? '-collapsed' : '') : 'none');
}
function nativeFailed() { C.toast('The browser panel didn’t open. Try again.', 'bad'); }
// The Browser button: opens or closes the native panel in the app, the web panel elsewhere.
function toggleBrowser() {
  if (C.native.hasPanel()) { var open = S.browser.nativeState && S.browser.nativeState.open;
    C.native.browser(open ? 'close' : 'open').then(syncNative, nativeFailed); return; }
  if (S.browser.layout === 'none') openBrowser(); else setLayout('none');
}
// Follows the panel while the chat is mounted; returns the function that stops following.
function startNativeBrowser() {
  if (!C.native.hasPanel()) return function () {};
  C.native.browser('state').then(syncNative, function () {});
  return C.native.on('browser', syncNative);
}
function applyTextSize() { document.documentElement.setAttribute('data-text', (S.settings && S.settings.textSize)
  || 'md'); }

export { applySplitWidth, applyTextSize, openBrowser, renderEmbed, setLayout, setMobileTab, startNativeBrowser,
  syncNative, toggleBrowser };
