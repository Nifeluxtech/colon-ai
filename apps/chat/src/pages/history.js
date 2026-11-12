/* Colon AI · History and Saved screens (grouped conversation lists with search and archive). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;

CW.pages = CW.pages || {};

function group(list) {
  var day = 86400000, start = new Date(); start.setHours(0, 0, 0, 0);
  var t = start.getTime(), groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Previous 30 days',
    []], ['Older', []]];
  list.forEach(function (c) {
    var d = new Date(c.updated_at).getTime();
    var g = d >= t ? 0 : d >= t - day ? 1 : d >= t - 7 * day ? 2 : d >= t - 30 * day ? 3 : 4;
    groups[g][1].push(c);
  });
  return groups.filter(function (g) { return g[1].length; });
}
function rowHtml(c) {
  var m = CW.MODES[c.mode] || CW.MODES.general;
  return '<div class="hist-row"><a href="#/c/' + encodeURIComponent(c.id)
    + '" class="hist-main"><span class="hist-ico">' + icon(m.icon) + '</span><span class="hist-body"><b>' + (c.pinned
    ? icon('pin', 'cw-pin') : '') + esc(c.title) + '</b>' +
    '<small>' + esc(c.preview || 'No messages yet') + '</small></span><span class="hist-meta"><span class="badge">'
      + esc(m.label) + '</span><time>' + esc(C.ago(c.updated_at)) + '</time></span></a>' +
    '<button class="icon-btn sm" data-hist-menu="' + esc(c.id) + '" aria-label="Options for ' + esc(c.title)
      + '" aria-haspopup="menu">' + icon('more') + '</button></div>';
}
function listPage(page, o) {
  page.innerHTML = '<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">' + esc(o.title)
    + '</h1><p class="lead">' + esc(o.lead) + '</p></div>' +
    '<a class="btn primary sm" href="#/">' + icon('plus') + 'New chat</a></header>' +
    (o.filters ? '<div class="hist-tools"><label class="cw-search wide">' + icon('search')
      + ('<input type="search" placeholder="Search your conversations…" aria-label="Search conversations" '
      + 'data-hq></label>') +
      '<div class="seg" role="group" aria-label="Filter">' + o.filters.map(function (f,
        i) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (i === 0) + '">' + f[1]
        + '</button>'; }).join('') + '</div></div>' : '') +
    ('<div class="hist-list" aria-live="polite"><div class="skel" style="height:64px"></div><div class="skel" '
      + 'style="height:64px;margin-top:8px"></div><div class="skel" '
      + 'style="height:64px;margin-top:8px"></div></div></div>');
  var state = { q: '', f: o.filters ? o.filters[0][0] : null, list: [] };
  function load() {
    var box = page.querySelector('.hist-list');
    CW.data.listConversations({ q: state.q, archived: state.f === 'archived' ? true : o.archived || false }).then(
      function (list) {
      if (state.f === 'pinned' || o.pinnedOnly) list = list.filter(function (c) { return c.pinned; });
      state.list = list;
      if (!list.length) {
        box.innerHTML = '<div class="card empty">' + icon(o.emptyIcon) + '<div class="h3">' + esc(state.q
          ? 'No conversations match “' + state.q + '”' : o.emptyTitle) + '</div><p class="small">' + esc(state.q
          ? 'Try different words.' : o.emptyText) + '</p>' + (state.q ? '' : '<a class="btn primary" href="#/">' + icon(
          'plus') + 'Start a chat</a>') + '</div>';
        return;
      }
      box.innerHTML = group(list).map(function (g) { return '<div class="section-title">' + g[0]
        + '</div><div class="list">' + g[1].map(rowHtml).join('') + '</div>'; }).join('');
    }).catch(function (e) {
      box.innerHTML = '<div class="card empty">' + icon('alert')
        + '<div class="h3">Couldn’t load conversations</div><p class="small">' + esc(e.message)
        + '</p><button class="btn" data-retry>' + icon('refresh') + 'Try again</button></div>';
      box.querySelector('[data-retry]').addEventListener('click', load);
    });
  }
  var hq = page.querySelector('[data-hq]');
  if (hq) hq.addEventListener('input', C.debounce(function () { state.q = hq.value.trim(); load(); }, 200));
  page.querySelectorAll('[data-f]').forEach(function (b) { b.addEventListener('click', function () { state.f =
    b.getAttribute('data-f'); page.querySelectorAll('[data-f]').forEach(function (x) { x.setAttribute('aria-pressed',
    x === b); }); load(); }); });
  page.addEventListener('click', function (e) {
    var m = e.target.closest('[data-hist-menu]'); if (!m) return;
    var c = state.list.filter(function (x) { return x.id === m.getAttribute('data-hist-menu'); })[0];
    if (c) CW.convMenu(m, c, load);
  });
  load();
}

CW.pages.history = function (page) {
  listPage(page, { title: 'History',
    lead: 'Every conversation, grouped by date. Search, rename, save, archive or delete.', filters: [['all', 'All'],
    ['pinned', 'Saved'], ['archived', 'Archived']],
    emptyIcon: 'history', emptyTitle: 'No conversations yet',
      emptyText: 'Chats you start with Colon Saga appear here.' });
};
CW.pages.saved = function (page) {
  listPage(page, { title: 'Saved', lead: 'Conversations you pinned to keep close.', pinnedOnly: true,
    emptyIcon: 'saved', emptyTitle: 'Nothing saved yet',
      emptyText: 'Open a conversation’s menu and choose Save to pin it here.' });
};
