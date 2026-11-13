/* Colon AI · the chat workspace screen: mount (layout, header, welcome), routing between the chat and the
   secondary screens, opening and starting conversations. The pieces live in components/, actions/ and core/.
   Data only through ColonChatData (core/data.js); browser only through ColonBrowser. */

import { bind, onKey } from './chat-events.js';
import { showShared } from './shared.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { send, stopStreaming } from '../actions/send-message.js';
import { applyTextSize, setMobileTab } from '../components/browser-panel.js';
import { autoGrow, composerHtml, renderModeChips, scrollBottom, syncComposer,
  syncJump } from '../components/composer.js';
import { renderThread } from '../components/message.js';
import { updateHeader } from '../components/model-picker.js';
import { applySidebar, closeDrawer, refreshConvs, renderConvs } from '../components/sidebar.js';
import { CW } from '../core/cw.js';
import { ColonChatData } from '../core/data.js';
import { $, PROMPTS, S, brandName, data, ephemeral, isMobile, setData, signedIn } from '../core/state.js';
import { ChatMedia } from '../lib/media.js';

var C = Colon, icon = C.icon, esc = C.esc;

function noticeBanner() {
  var cfg = C.config || {}, out = '';
  if (cfg.maintenance && cfg.maintenance.on) out += '<div class="banner bad cw-notice" role="status">' + icon('alert')
    + '<span>' + esc(cfg.maintenance.message) + '</span></div>';
  var a = cfg.announcement;
  if (a && a.text) {
    var key = 'colon.banner.' + a.text.length + '.' + a.text.slice(0, 24);
    var hidden = false; try { hidden = sessionStorage.getItem(key) === '1'; } catch (e) {}
    if (!hidden) out += '<div class="banner ' + (a.tone === 'warn' ? '' : 'info')
      + ' cw-notice" role="status" data-banner="' + esc(key) + '">' + icon(a.tone === 'warn' ? 'alert' : 'bell')
      + '<span>' + esc(a.text)
      + '</span><button type="button" class="icon-btn sm" data-banner-x aria-label="Hide announcement">' + icon('x')
      + '</button></div>';
  }
  return out;
}
function bindNotice(root) {
  var b = root.querySelector('[data-banner-x]'); if (!b) return;
  b.addEventListener('click', function () { var box = b.closest('[data-banner]'); try { sessionStorage.setItem(
    box.getAttribute('data-banner'), '1'); } catch (e) {} box.remove(); });
}
function login(mode) { if (typeof C.authModal === 'function') C.authModal({ mode: mode || 'login',
  lead: mode === 'signup' ? 'Save your chats, upload images and pick up on any device.' :
  'Log in to save your chats and pick up on any device.' }); else C.go(mode === 'signup' ? '/register' : '/login'); }
CW.login = login;

/* ================= Mount ================= */
function mount(view, ctx) {
  // Optional kit helpers are feature-checked: an older cached kit must never crash the app.
  if (typeof C.keyboard === 'function') C.keyboard();
  setData(CW.data = ColonChatData.get());
  document.documentElement.classList.add('app-lock');
  view.innerHTML =
    '<a class="skip-link" href="#cw-input">Skip to message box</a>' +
    '<div class="cw" data-layout="none" data-view="chat">' +
    '<aside class="cw-side" id="cw-side" aria-label="Conversations">' +
      '<div class="cw-side-top"><a href="#/" class="cw-logo" aria-label="Colon AI home">' + C.logo(brandName(),
        'by Nifelux') + '</a>' +
      '<button class="icon-btn sm cw-side-close" data-a="drawer-close" aria-label="Close menu">' + icon('x')
        + '</button></div>' +
      '<button class="btn primary block cw-new" data-a="new">' + icon('plus') + 'New Chat</button>' +
      '<label class="cw-search">' + icon('search')
        + ('<input type="search" placeholder="Search chats…" aria-label="Search conversations" id="cw-q"><span '
        + 'class="kbd cw-hide-touch">Ctrl K</span></label>') +
      '<nav class="nav-list cw-nav" aria-label="Main">' +
        navLink('/', 'home', 'Home') + navLink('/explore', 'explore', 'Explore') +
        navLink('/cbt', 'target', 'CBT practice') +
        (ephemeral() ? '' : navLink('/saved', 'saved', 'Saved') + navLink('/history', 'history', 'History')) +
        (signedIn() ? navLink('/settings', 'settings', 'Settings') : '') + navLink('/help', 'help', 'Help & Support')
          + '</nav>' +
      '<div class="cw-convs scroll-y" id="cw-convs" aria-label="Recent conversations"></div>' +
      (signedIn()
        ? ('<button class="cw-account" data-a="profile" aria-haspopup="menu"><span class="avatar sm" '
          + 'data-avatar></span><span class="cw-account-body"><b data-uname></b><small '
          + 'data-urole></small></span><span class="status-dot" title="Online"></span></button>')
        : ('<div class="cw-auth-btns"><button type="button" class="btn primary sm" data-a="login">Log '
          + 'in</button><button type="button" class="btn sm" data-a="signup">Sign up</button></div>')) +
    '</aside>' +
    '<div class="cw-main">' +
      '<header class="cw-head">' +
        ('<button class="icon-btn" data-a="sidebar" aria-label="Toggle sidebar" aria-controls="cw-side" '
          + 'data-tip="Sidebar">') + icon('sidebar') + '</button>' +
        '<a href="#/" class="cw-head-logo" aria-label="Colon AI home">' + C.logo(brandName(), false) + '</a>' +
        ('<button class="cw-model" data-a="model" aria-haspopup="menu" aria-label="Choose model"><span '
          + 'class="cw-model-mark">') + C.MARK
          + ('</span><span class="cw-model-t"><b data-model-name>Colon Saga</b><small data-mode-sub>General '
          + 'Assistant</small></span>') + icon('chevDown') + '</button>' +
        ('<button class="cw-title" data-a="rename-current" aria-label="Rename conversation" data-tip="Rename"><span '
          + 'data-title></span>') + icon('edit') + '</button>' +
        '<span class="cw-head-sp"></span>' +
        '<button class="icon-btn" data-a="new" aria-label="New chat" data-tip="New chat (Ctrl Shift O)">' + icon(
          'plus') + '</button>' +
        ('<button class="icon-btn cw-hide-xs" data-a="browser" aria-label="Open browser panel" aria-pressed="false" '
          + 'data-tip="Browser">') + icon('globe') + '<span class="dot" hidden></span></button>' +
        ('<button class="cw-theme cw-hide-xs" data-a="theme" aria-label="Toggle light or dark theme" '
          + 'data-tip="Theme"><span class="cw-theme-sun">') + icon('sun')
          + '</span><span class="cw-theme-track"><i></i></span></button>' +
        '<button class="icon-btn cw-show-xs" data-a="more" aria-label="More options" aria-haspopup="menu">' + icon(
          'moreV') + '</button>' +
        (signedIn()
          ? ('<button class="cw-avatar-btn cw-hide-xs" data-a="profile" aria-haspopup="menu" aria-label="Profile '
          + 'menu"><span class="avatar sm" data-avatar></span></button>')
          : ('<span class="cw-head-auth"><button type="button" class="btn primary sm" data-a="login">Log '
            + 'in</button><button type="button" class="btn sm cw-hide-xs" data-a="signup">Sign up</button></span>')) +
      '</header>' +
      ('<div class="cw-mswitch seg block" role="tablist" aria-label="Chat or browser"><button type="button" '
        + 'data-a="mtab" data-t="chat" aria-pressed="true">') + icon('chat')
        + 'Chat</button><button type="button" data-a="mtab" data-t="browser" aria-pressed="false">' + icon('globe')
        + 'Browser</button></div>' +
      '<div class="cw-body">' +
        '<section class="cw-chat" aria-label="Conversation">' +
          ('<div class="cw-scroll scroll-y" id="cw-scroll"><div class="cw-page" id="cw-page"></div><div '
            + 'class="cw-embed-host"></div></div>') +
          composerHtml() +
        '</section>' +
        '<div class="resizer cw-resizer" aria-label="Resize browser panel"></div>' +
        ('<section class="cw-split" aria-label="Browser panel"><div class="cw-split-head"><span class="status-dot" '
          + 'data-bdot></span><b>Colon Browser</b><span class="tiny muted cw-ellipsis" data-burl></span>') +
          ('<button class="icon-btn sm" data-a="layout-embed" aria-label="Show inside the conversation" '
            + 'data-tip="Embed in chat">') + icon('panel') + '</button>' +
          '<button class="icon-btn sm" data-a="browser-close" aria-label="Close browser" data-tip="Close">' + icon('x')
            + '</button></div><div class="cw-split-body"></div></section>' +
      '</div>' +
    '</div>' +
    '<div class="cw-drawer-back" data-a="drawer-close"></div></div>';
  S.el = view.querySelector('.cw');
  fillUser();
  bind();
  S.media = ChatMedia.create({
    data: data, tray: $('.att-tray'), voiceBar: $('.cv-voice'), getSettings: function () { return S.settings || {}; },
    onVoiceLang: function (lang) { S.settings.voice = Object.assign({}, S.settings.voice, { lang: lang });
      data.saveSettings({ voice: { lang: lang } }).catch(function () {}); },
    onChange: syncComposer, onVoiceState: function (on) { $('[data-a=mic]').classList.toggle('rec', on);
      $('[data-a=mic]').setAttribute('aria-pressed', on); },
    onTranscript: function (text, final) {
      var ta = $('#cw-input');
      if (final === 'cancel') { ta.value = ta.dataset.before || ''; autoGrow(); return; }
      if (ta.dataset.before === undefined) ta.dataset.before = ta.value ? ta.value + ' ' : '';
      ta.value = ta.dataset.before + text; autoGrow(); syncComposer();
      if (final === true) { delete ta.dataset.before; if (S.settings.voice.autoSend && text) send(); else ta.focus(); }
    }
  });
  S.collapsed = localStorage.getItem('colon.sidebar') === 'closed';
  applySidebar();
  Promise.all([
    data.getSettings().then(function (s) { S.settings = s; S.draftMode = s.defaultMode || 'general'; applyTextSize();
      }),
    data.listModels().then(function (m) { S.models = m; }).catch(function () { S.models = [];
      C.toast('Couldn’t load the model list. Using Colon Saga.', 'bad'); })
  ]).then(function () { refreshConvs(); route(ctx); });
  return function unmount() {
    if (S.streaming) S.streaming.ctl.abort(); if (S.media) S.media.destroy(); document.removeEventListener('keydown',
      onKey);
    if (S.ro) S.ro.disconnect(); document.documentElement.classList.remove('app-lock');
  };
}
function navLink(href, ic, label) { return '<a href="#' + href + '" data-nav="' + href + '">' + icon(ic) + '<span>'
  + label + '</span></a>'; }
function disclaimer() {
  if (data.kind === 'local') return '<span class="badge cyan" data-tip="' + esc(data.describe) + '">' + icon('info')
    + 'Preview</span><span>Can’t reach Colon right now, so replies are generated on this device.</span>';
  if (data.kind === 'guest') return '<span class="badge cyan" data-tip="' + esc(data.describe) + '">' + icon('info')
    + ('Not saved</span><span>Colon Saga can make mistakes. <button type="button" class="link cw-inline-link" '
    + 'data-a="login">Log in</button> to save your chats.</span>');
  return '<span class="badge cyan" data-tip="' + esc(data.describe) + '">' + icon('info')
    + 'Synced</span><span>Colon Saga can make mistakes. Check important information.</span>';
}
function fillUser() {
  var u = C.user || {};
  S.el.querySelectorAll('[data-avatar]').forEach(function (a) { a.textContent = C.initials(u.name, u.email); });
  var n = $('[data-uname]'), r = $('[data-urole]');
  if (n) n.textContent = u.name || 'Your account';
  if (r) r.textContent = C.roleName(u.role || 'user') + (u.email_verified ? '' : ' · unverified');
}

/* ================= Routing inside the workspace ================= */
// Called as route(ctx) internally and as update(view, ctx) by the Colon router.
function route(a, b) {
  var ctx = (b && b.path !== undefined) ? b : a;
  if (!S.settings || !ctx) return;
  var p = ctx.path || '/';
  closeDrawer();
  S.el.querySelectorAll('[data-nav]').forEach(function (a) { var on = a.getAttribute('data-nav') === (p.indexOf(
    '/c/') === 0 ? '/' : p); a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current'); });
  var m = /^\/c\/([^/]+)$/.exec(p);
  if (m) return openConversation(decodeURIComponent(m[1]));
  var sh = /^\/share\/([^/]+)$/.exec(p);
  if (sh) return showShared(decodeURIComponent(sh[1]));
  var pages = { '/history': 'history', '/saved': 'saved', '/explore': 'explore', '/settings': 'settings',
    '/help': 'help', '/cbt': 'cbt' };
  if (pages[p] && ((ephemeral() && (p === '/history' || p === '/saved')) || (!signedIn()
    && p === '/settings'))) return showPage('login', ctx);
  if (pages[p]) return showPage(pages[p], ctx);
  newChat(true);
}
CW.route = route;

function setView(v) {
  S.view = v; S.el.setAttribute('data-view', v);
  S.stick = true; syncJump();
  $('.cw-composer').hidden = v !== 'chat' && v !== 'welcome';  // pages and shared chats have no composer
  $('.cw-embed-host').hidden = v !== 'chat';
  if (v !== 'chat' && v !== 'welcome' && S.browser.layout === 'split' && isMobile()) setMobileTab('chat');
}
function showPage(name, ctx) {
  if (S.streaming) { /* keep streaming in background */ }
  S.current = null; S.messages = []; setView(name);
  var page = $('#cw-page'); page.className = 'cw-page cw-page-' + name;
  updateHeader();
  var fn = CW.pages && CW.pages[name];
  if (fn) fn(page, ctx); else page.innerHTML = '<div class="empty">Page not found.</div>';
  $('#cw-scroll').scrollTop = 0;
  renderConvs();
}

function newChat(fromRoute) {
  if (S.streaming) stopStreaming();
  S.current = null; S.messages = []; S.draftModel = null;
  S.draftMode = (S.settings && S.settings.defaultMode) || 'general';
  setView('welcome');
  if (!fromRoute && location.hash !== '#/' && location.hash !== '') { C.go('/'); return; }
  renderWelcome(); updateHeader(); syncComposer(); renderConvs();
  if (!isMobile()) setTimeout(function () { $('#cw-input').focus(); }, 30);
}

function openConversation(id) {
  setView('chat');
  if (S.current && S.current.id === id && S.messages) { renderThread(); updateHeader(); syncComposer(); renderConvs();
    return; }
  if (S.streaming) stopStreaming();
  S.loadingConv = true; S.current = { id: id, title: 'Loading…', mode: S.draftMode };
  updateHeader();
  $('#cw-page').className = 'cw-page'; $('#cw-page').innerHTML = '<div class="cw-thread">' + [1, 2, 3].map(function (
    i) { return '<div class="cw-skel ' + (i % 2 ? 'u' : 'a') + '"><div class="skel" style="height:' + (i % 2 ? 44 : 96)
    + 'px"></div></div>'; }).join('') + '</div>';
  data.getConversation(id).then(function (r) {
    if (!S.current || S.current.id !== id) return;
    S.current = r.conversation; S.messages = r.messages; S.loadingConv = false;
    S.messages.forEach(function (m) { S.seen[m.id] = 1; });  // history appears without replaying entry animations
    renderThread(); updateHeader(); syncComposer(); renderConvs(); scrollBottom(true);
  }).catch(function (e) {
    S.loadingConv = false;
    $('#cw-page').innerHTML = '<div class="empty cw-error-page">' + icon(e.code === 'not_found' ? 'search' : 'alert')
      + '<div class="h3">' + (e.code === 'not_found' ? 'Conversation not found' : 'Couldn’t open this conversation')
      + '</div><p class="small">' + esc(e.message) + '</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' + (e.code === 'not_found'
        ? '' : '<button class="btn" data-a="retry-open">' + icon('refresh') + 'Try again</button>')
        + '<a class="btn primary" href="#/">' + icon('plus') + 'New chat</a></div></div>';
    var b = $('[data-a=retry-open]'); if (b) b.addEventListener('click', function () { S.current = null;
      openConversation(id); });
    S.current = null; updateHeader();
  });
}
CW.open = function (id) { C.go('/c/' + encodeURIComponent(id)); };

/* ================= Welcome ================= */
function renderWelcome() {
  var page = $('#cw-page'); page.className = 'cw-page cw-page-welcome';
  page.innerHTML = noticeBanner() + (typeof C.verifyBanner === 'function' ? C.verifyBanner() : '')
    + '<section class="cw-welcome">' +
    '<div class="cw-hero-mark" aria-hidden="true">' + C.MARK + '</div>' +
    '<h1 class="cw-hero-h">What can we explore today?</h1>' +
    '<p class="cw-hero-p">Your ideas, questions and ambitions start here.</p>' +
    '<div class="cw-prompts">' + PROMPTS.map(function (p, i) {
      return '<button type="button" class="cw-prompt" data-prompt="' + i + '"><span class="cw-prompt-ico i' + i + '">'
        + icon(p.icon) + '</span><b>' + esc(p.title) + '</b><span>' + esc(p.text) + '</span></button>';
    }).join('') + '</div>' +
    '<div class="cw-welcome-modes chips" role="radiogroup" aria-label="Mode"></div></section>';
  if (typeof C.bindBanner === 'function') C.bindBanner(page);
  bindNotice(page);
  renderModeChips();  // mode chips scroll with the welcome content, above the floating composer
}
CW.applySettings = function (s) { S.settings = s; applyTextSize(); if (S.view === 'chat') renderThread(); };
CW.media = function () { return S.media; };

CW.mount = mount;
CW.newChat = newChat;
CW.startWith = function (prompt, m) { C.go('/'); setTimeout(function () { S.draftMode = m || 'general'; updateHeader();
  var ta = $('#cw-input'); ta.value = prompt; autoGrow(); syncComposer(); ta.focus(); }, 60); };

export { disclaimer, login, newChat, setView };
