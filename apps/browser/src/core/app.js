/* Colon Browser · standalone app shell: navigation (Home, Tabs, Bookmarks, History, Downloads,
   AI Browse, Settings, Help) around the shared ColonBrowser module. All state goes through
   ColonBrowserData (packages/ui/js/browser/data.js). Sections live in pages/, shared chrome in components/. */

import { $, B, NAV, S } from './state.js';
import { ColonBrowserData } from '../../../../packages/ui/js/browser/data.js';
import { ColonBrowser } from '../../../../packages/ui/js/browser/index.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { onClick, render, syncChrome, themeIcon } from '../components/chrome.js';

var C = Colon, icon = C.icon, esc = C.esc;

function mount(view, ctx) {
  // Optional kit helpers are feature-checked: an older cached kit must never crash the app.
  if (typeof C.keyboard === 'function') C.keyboard();
  document.documentElement.classList.add('app-lock');
  S.data = ColonBrowserData.get();
  view.innerHTML = '<div class="bw">' +
    ('<aside class="bw-side" aria-label="Browser navigation"><a href="#/" class="bw-logo" aria-label="Colon Browser '
      + 'home">') + C.logo('COLON', 'BROWSER') + '</a>' +
    '<nav class="nav-list" aria-label="Main">' + NAV.map(function (n) { return '<a href="#' + n[1] + '" data-sec="'
      + n[0] + '">' + icon(n[2]) + '<span>' + n[3] + '</span>' + (n[0] === 'tabs'
      ? '<span class="count" data-tabcount>1</span>' : '') + '</a>'; }).join('') + '</nav>' +
    ('<div class="bw-side-foot"><a class="bw-ai-card" href="https://chat.apparatus.name.ng/" target="_blank" '
      + 'rel="noopener">') + C.MARK + '<span><b>Colon AI</b><small>Ask Saga about any page</small></span>' + icon(
      'external') + '</a>' +
    '<button class="cw-account bw-account" data-a="profile" aria-haspopup="menu"><span class="avatar sm">'
      + esc(C.initials(C.user && C.user.name, C.user && C.user.email)) + '</span><span class="cw-account-body"><b>'
      + esc((C.user && C.user.name) || 'Account') + '</b><small>' + esc(S.data.describe)
      + '</small></span></button></div></aside>' +
    '<div class="bw-main">' +
      '<header class="bw-mhead"><a href="#/" class="bw-logo">' + C.logo('COLON', 'BROWSER')
        + '</a><span class="bw-sp"></span>' +
      '<button class="icon-btn" data-a="theme" aria-label="Toggle theme">' + icon('moon')
        + '</button><button class="icon-btn" data-a="menu" aria-label="Open menu" aria-haspopup="dialog">' + icon(
        'menu') + '</button></header>' +
      '<div class="bw-browser" data-host></div>' +
      '<section class="bw-page scroll-y" hidden><div class="bw-page-in"></div></section>' +
    '</div>' +
    '<nav class="bw-bottom tabbar" aria-label="Browser controls">' +
      '<button data-a="back" aria-label="Back">' + icon('left') + '<span>Back</span></button>' +
      '<button data-a="forward" aria-label="Forward">' + icon('right') + '<span>Forward</span></button>' +
      '<button data-a="home" aria-label="Home">' + icon('home') + '<span>Home</span></button>' +
      '<button data-a="tabs" aria-label="Tabs"><span class="bw-tabsq" data-tabcount>1</span><span>Tabs</span></button>'
        +
      '<button data-a="menu" aria-label="Menu">' + icon('menu') + '<span>Menu</span></button></nav>' +
    '</div>';
  S.el = view.querySelector('.bw');
  S.inst = ColonBrowser.create($('[data-host]'), { variant: 'full', onNavigateApp: function (sec) { C.go('/' + sec);
    } });
  S.inst.on('change', syncChrome);
  S.inst.on('downloads', function () { if (S.section === 'downloads') render('downloads'); });
  S.el.addEventListener('click', onClick);
  C.theme.on(themeIcon); themeIcon();
  S.inst.ready.then(function () { route(ctx); syncChrome(); });
  return function () { S.inst.destroy(); document.documentElement.classList.remove('app-lock'); };
}

function route(a, b) {
  var ctx = (b && b.path !== undefined) ? b : a; if (!ctx) return;
  var p = ctx.path || '/', sec = (NAV.filter(function (n) { return n[1] === p; })[0] || NAV[0])[0];
  S.section = sec;
  S.el.querySelectorAll('[data-sec]').forEach(function (l) { var on = l.getAttribute('data-sec') === sec
    || (sec === 'ai' && false); l.classList.toggle('active', on); if (on) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current'); });
  var page = $('.bw-page');
  if (sec === 'home' || sec === 'ai') {
    page.hidden = true; $('.bw-browser').hidden = false; S.el.setAttribute('data-sec', 'home');
    if (sec === 'ai') { S.inst.toggleSide(true); setTimeout(function () { var t = S.inst.el.querySelector(
      '.cb-task-form textarea'); if (t) t.focus(); }, 120); }
    document.title = 'Colon Browser';
    return;
  }
  $('.bw-browser').hidden = true; page.hidden = false; S.el.setAttribute('data-sec', sec);
  render(sec); page.scrollTop = 0;
  document.title = (NAV.filter(function (n) { return n[0] === sec; })[0] || ['', '', '', ''])[3] + ' · Colon Browser';
}

B.mount = mount;
B.route = route;

export { B as CB };
