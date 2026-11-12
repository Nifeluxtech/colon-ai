/* Colon Browser · app chrome: toolbar state, menus, and the building blocks every section page uses. */

import { ColonBrowser } from '../../../../packages/ui/js/browser/index.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { $, NAV, S } from '../core/state.js';
import { PAGES } from '../pages/index.js';

var C = Colon, icon = C.icon, esc = C.esc, U = ColonURL;

function syncChrome() {
  var st = S.inst.state(); if (!st) return;
  S.el.querySelectorAll('[data-tabcount]').forEach(function (n) { n.textContent = st.tabs.length; });
  var bb = $('.bw-bottom [data-a=back]'), active = st.active;
  if (bb) { /* enabled state mirrors the toolbar */ var tb = S.inst.el.querySelector('.cb-toolbar [data-a=back]'),
    tf = S.inst.el.querySelector('.cb-toolbar [data-a=forward]'); bb.disabled = !!(tb && tb.disabled);
    $('.bw-bottom [data-a=forward]').disabled = !!(tf && tf.disabled); }
  if (S.section === 'tabs') render('tabs');
  void active;
}
function themeIcon() { var b = S.el && S.el.querySelector('.bw-mhead [data-a=theme]'); if (b) b.innerHTML = icon(
  C.theme.current() === 'dark' ? 'sun' : 'moon'); }

function onClick(e) {
  var a = e.target.closest('[data-a]'); if (!a || !S.el.contains(a)) return;
  if (a.closest('.cb')) return; // the browser module handles its own buttons
  var act = a.getAttribute('data-a');
  var acts = {
    back: function () { goHome(); S.inst.back(); }, forward: function () { goHome(); S.inst.forward();
      }, home: function () { goHome(); S.inst.home(); },
    tabs: function () { C.go('/tabs'); }, menu: openMenu, theme: function () { C.theme.toggle(); }, profile: function (
      ) { profileMenu(a); }
  };
  if (acts[act]) acts[act]();
}
function goHome() { if (S.section !== 'home') C.go('/'); }

function openMenu() {
  var st = S.inst.state();
  C.sheet('<div class="bw-menu-head">' + C.logo('COLON', 'BROWSER') + '</div>' +
    ('<div class="bw-menu-modes"><div class="tiny muted" style="margin:0 2px 6px">Control mode</div><div class="seg '
      + 'block" role="group" aria-label="Control mode">') +
    ['ai', 'manual', 'shared'].map(function (m) { return '<button type="button" data-m="' + m + '" aria-pressed="'
      + (st.control === m) + '">' + icon(ColonBrowser.MODES[m].icon) + ColonBrowser.MODES[m].short + '</button>';
      }).join('') + '</div></div>' +
    '<nav class="nav-list" style="margin-top:12px">' + NAV.map(function (n) { return '<a href="#' + n[1]
      + '" data-close>' + icon(n[2]) + '<span>' + n[3] + '</span>' + (n[0] === 'tabs' ? '<span class="count">'
      + st.tabs.length + '</span>' : '') + '</a>'; }).join('') + '</nav>' +
    '<div class="sheet-actions"><button class="btn" data-newtab>' + icon('plus')
      + 'New tab</button><button class="btn" data-close>Close</button></div>', function (el, close) {
    el.querySelectorAll('[data-m]').forEach(function (b) { b.addEventListener('click', function () { S.inst.setControl(
      b.getAttribute('data-m')); close(); }); });
    el.querySelector('[data-newtab]').addEventListener('click', function () { close(); goHome(); S.inst.newTab(); });
    el.querySelectorAll('a[data-close]').forEach(function (l) { l.addEventListener('click', close); });
  }, { label: 'Browser menu' });
}
function profileMenu(anchor) {
  var u = C.user || {};
  C.menu(anchor, [
    { html: '<div class="cw-menu-user"><span class="avatar">' + esc(C.initials(u.name, u.email)) + '</span><span><b>'
      + esc(u.name || '') + '</b><small>' + esc(u.email || '') + '</small></span></div>' }, '-',
    { label: 'Account & security', icon: 'shield', onClick: function () { C.go('/account'); } },
    { label: C.theme.current() === 'dark' ? 'Light mode' : 'Dark mode', icon: C.theme.current() === 'dark'
      ? 'sun' : 'moon', onClick: function () { C.theme.toggle(); } }, '-',
    { label: 'Sign out', icon: 'out', danger: true, onClick: function () { C.confirm({ title: 'Sign out of Colon?',
      confirm: 'Sign out' }).then(function (ok) { if (ok) C.logout(); }); } }
  ], { label: 'Profile' });
}

/* ---------------- Section pages ---------------- */
function head(title, lead, actions) {
  return '<header class="bw-page-head"><button class="icon-btn bw-back" data-go-home aria-label="Back to browser">'
    + icon('back') + '</button><div><h1 class="h1">' + esc(title) + '</h1><p class="lead">' + esc(lead)
    + '</p></div><div class="bw-page-acts">' + (actions || '') + '</div></header>';
}
function render(sec) {
  var box = $('.bw-page-in'); var fn = PAGES[sec]; if (!fn) return;
  fn(box);
  var back = box.querySelector('[data-go-home]'); if (back) back.addEventListener('click', function () { C.go('/'); });
}
function groupByDate(list, key) {
  var day = 86400000, start = new Date(); start.setHours(0, 0, 0, 0); var t = start.getTime();
  var g = [['Today', []], ['Yesterday', []], ['Earlier this week', []], ['Earlier', []]];
  list.forEach(function (x) { var d = new Date(x[key]).getTime(); g[d >= t ? 0 : d >= t - day ? 1 : d >= t - 7 * day
    ? 2 : 3][1].push(x); });
  return g.filter(function (x) { return x[1].length; });
}
function fav(url) { var h = U.hostOf(url), n = 0; for (var i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(
  i)) >>> 0; return '<span class="cb-fav" style="background:' + (/^colon:/.test(url) ? 'var(--primary)' : 'hsl('
  + (n % 360) + ' 62% 46%)') + '">' + esc(/^colon:/.test(url) ? 'C' : ((h.split('.').length > 2 ? h.split('.').slice(
  -2)[0] : h)[0] || '•').toUpperCase()) + '</span>'; }
function openUrl(url) { C.go('/'); setTimeout(function () { S.inst.navigate(url); }, 30); }
function errBox(box, e, retry) { box.innerHTML = '<div class="card empty">' + icon('alert')
  + '<div class="h3">Something went wrong</div><p class="small">' + esc(e.message)
  + '</p><button class="btn" data-retry>' + icon('refresh') + 'Try again</button></div>';
  box.querySelector('[data-retry]').addEventListener('click', retry); }

export { errBox, fav, groupByDate, head, onClick, openUrl, render, syncChrome, themeIcon };
