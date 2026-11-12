/* Colon Browser · History section. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { errBox, fav, groupByDate, head, openUrl } from '../components/chrome.js';
import { S } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, U = ColonURL;

function historyPage(box) {
  var q = box.getAttribute('data-q') || '';
  box.innerHTML = head('History', 'Pages you visited, newest first.', '<button class="btn danger sm" data-clear>'
    + icon('trash') + 'Clear history</button>') +
    '<label class="cw-search wide bw-search">' + icon('search')
      + '<input type="search" placeholder="Search history" aria-label="Search history" value="' + esc(q)
      + '"></label><div class="bw-hist"><div class="skel" style="height:160px"></div></div>';
  var inp = box.querySelector('input');
  inp.addEventListener('input', C.debounce(function () { box.setAttribute('data-q', inp.value); load(); }, 200));
  function load() {
    var out = box.querySelector('.bw-hist');
    S.data.listHistory({ q: inp.value.trim() }).then(function (list) {
      if (!list.length) { out.innerHTML = '<div class="card empty">' + icon('history') + '<div class="h3">'
        + (inp.value ? 'Nothing matches “' + esc(inp.value) + '”' : 'No history yet') + '</div><p class="small">'
        + (inp.value ? 'Try another word.' : 'Pages you open appear here.') + '</p></div>'; return; }
      out.innerHTML = groupByDate(list, 'visited_at').map(function (g) {
        return '<div class="section-title">' + g[0] + '</div><div class="list">' + g[1].map(function (h) {
          return '<div class="bw-row"><time>' + new Date(h.visited_at).toLocaleTimeString([], { hour: '2-digit',
            minute: '2-digit' }) + '</time>' + fav(h.url) + '<a href="' + esc(h.url) + '" data-open="' + esc(h.url)
            + '" class="bw-row-main"><b>' + esc(h.title) + '</b><small>' + esc(U.displayUrl(h.url)) + '</small></a>' +
            '<button class="icon-btn sm" data-rm="' + esc(h.id) + '" aria-label="Remove ' + esc(h.title)
              + ' from history">' + icon('x') + '</button></div>';
        }).join('') + '</div>';
      }).join('');
      out.querySelectorAll('[data-open]').forEach(function (a) { a.addEventListener('click', function (e) {
        e.preventDefault(); openUrl(a.getAttribute('data-open')); }); });
      out.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function () {
        S.data.removeHistory(b.getAttribute('data-rm')).then(function () { b.closest('.bw-row').remove();
        C.toast('Removed from history.'); }); }); });
    }).catch(function (e) { errBox(out, e, load); });
  }
  box.querySelector('[data-clear]').addEventListener('click', function () {
    C.confirm({ title: 'Clear all history?',
      body: 'Every visited page will be removed from history. Bookmarks and tabs stay.', confirm: 'Clear history',
      danger: true }).then(function (ok) { if (ok) S.data.clearHistory().then(function () { C.toast(
      'History cleared.'); load(); }); });
  });
  load();
}

export { historyPage };
