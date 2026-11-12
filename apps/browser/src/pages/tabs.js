/* Colon Browser · Tabs section. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { fav, head, render } from '../components/chrome.js';
import { S } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, U = ColonURL;

function tabsPage(box) {
  var st = S.inst.state();
  box.innerHTML = head('Tabs', st.tabs.length + ' open · restored when you come back',
    '<button class="btn sm" data-closeall>Close all</button><button class="btn primary sm" data-new>' + icon('plus')
    + 'New tab</button>') +
    '<div class="bw-tabgrid">' + st.tabs.map(function (t) {
      return '<div class="bw-tabcard' + (t.active ? ' on' : '') + '"><button class="bw-tabcard-main" data-switch="'
        + esc(t.id) + '" aria-label="Switch to ' + esc(t.title) + '"><span class="bw-tabcard-top">' + fav(t.url)
        + '<b>' + esc(t.title || 'New tab') + '</b></span>' +
        '<span class="bw-tabcard-prev">' + (/^colon:/.test(t.url) ? C.logo('COLON', false) : '<span class="mono">'
          + esc(U.displayUrl(t.url)) + '</span>') + '</span>' + (t.active
          ? '<span class="badge primary">Active</span>' : '') + '</button>' +
        '<button class="icon-btn sm bw-tabcard-x" data-close="' + esc(t.id) + '" aria-label="Close ' + esc(t.title)
          + '">' + icon('x') + '</button></div>';
    }).join('') + '</div>';
  box.querySelector('[data-new]').addEventListener('click', function () { C.go('/'); S.inst.newTab(); });
  box.querySelector('[data-closeall]').addEventListener('click', function () {
    C.confirm({ title: 'Close all tabs?', body: 'You’ll start again with one new tab.', confirm: 'Close all',
      danger: true }).then(function (ok) { if (ok) { S.inst.state().tabs.forEach(function (t) { S.inst.closeTab(
      t.id); }); render('tabs'); } });
  });
  box.querySelectorAll('[data-switch]').forEach(function (b) { b.addEventListener('click', function () {
    S.inst.switchTab(b.getAttribute('data-switch')); C.go('/'); }); });
  box.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () {
    S.inst.closeTab(b.getAttribute('data-close')); render('tabs'); }); });
}

export { tabsPage };
