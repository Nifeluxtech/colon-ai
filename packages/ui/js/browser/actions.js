/* ColonBrowser · toolbar actions: tabs and more menus, bookmark, download, full screen, side panel,
   suggestions. */

import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';
import { saveBlob } from './shared.js';

var C = Colon, U = ColonURL, esc = C.esc;

export function installActions(ctx) {
  function hideSuggest() { ctx.suggestBox.hidden = true; }
  function tabsMenu(anchor) {
    C.menu(anchor, [{ head: ctx.session.tabs.length + ' tabs' }].concat(ctx.session.tabs.map(function (t) { return {
      label: t.title || 'New tab', sub: /^colon:/.test(t.url) ? '' : U.displayUrl(t.url), icon: 'globe',
      checked: t.id === ctx.session.active_id, onClick: function () { ctx.switchTab(t.id); } }; }), ['-',
        { label: 'New tab',
      icon: 'plus', onClick: function () { ctx.newTab(); } }, { label: 'Close this tab', icon: 'x', onClick: function (
        ) {
      ctx.closeTab(ctx.session.active_id); } }]), { align: 'right', label: 'Tabs' });
  }
  function moreMenu(anchor) {
    var t = ctx.active(), app = ctx.opts.onNavigateApp;
    var items = [{ label: 'New tab', icon: 'plus', onClick: function () { ctx.newTab(); } },
      { label: 'Copy link', icon: 'link', disabled: /^colon:/.test(t.url), onClick: function () { C.copyText(
        t.url).then(function () { C.toast('Link copied.'); }); } },
      { label: 'Open original in new tab', icon: 'external', disabled: /^colon:/.test(t.url), onClick: function () {
        window.open(t.url, '_blank', 'noopener'); } },
      { label: 'Download page', icon: 'download', onClick: downloadCurrent },
      { label: 'Full screen', icon: 'maximize', onClick: toggleFullscreen }];
    if (app) items.push('-', { label: 'Bookmarks', icon: 'bookmark', onClick: function () { app('bookmarks');
      } }, { label: 'History', icon: 'history', onClick: function () { app('history'); } }, { label: 'Downloads',
      icon: 'download', onClick: function () { app('downloads'); } }, { label: 'Settings', icon: 'settings',
      onClick: function () { app('settings'); } });
    C.menu(anchor, items, { align: 'right', label: 'More' });
  }
  function bookmarkCurrent() {
    var t = ctx.active(); if (/^colon:/.test(t.url)) return;
    var bm = ctx.bookmarks.filter(function (b) { return b.url === t.url; })[0];
    if (bm) return ctx.api.editBookmark(bm);
    ctx.data.addBookmark({ url: t.url, title: t.title }).then(function (b) { return refreshBookmarks().then(function (
      ) {
      C.toast('Bookmarked.', 'ok', { label: 'Edit', fn: function () { ctx.api.editBookmark(b); } }); }); })
      .catch(function (e) { C.toast(e.message, 'bad'); });
  }
  function downloadCurrent() {
    var t = ctx.active(), pg = ctx.pages[t.id]; if (!pg || !pg.page || !pg.page.html) return C.toast(
      'Nothing to download on this page.');
    var name = (pg.page.title || U.hostOf(t.url) || 'page').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + '.html';
    var doc = '<!doctype html><meta charset="utf-8"><title>' + esc(pg.page.title)
      + ('</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:40px auto;padding:0 '
      + '16px}img{max-width:100%;height:auto}</style><p><small>Saved by Colon Browser from <a href="') + esc(t.url)
      + '">' + esc(t.url) + '</a></small></p><h1>' + esc(pg.page.title) + '</h1>' + pg.page.html;
    var blob = new Blob([doc], { type: 'text/html' });
    ctx.data.addDownload({ name: name, type: 'text/html', size: blob.size, url: t.url, status: 'complete',
      blob: blob }).then(function () { saveBlob(blob, name); C.toast('Saved to Downloads.', 'ok', ctx.opts.onNavigateApp
      ? { label: 'View', fn: function () { ctx.opts.onNavigateApp('downloads'); } } : null); ctx.emit('downloads'); })
      .catch(function (e) { C.toast(e.message, 'bad'); });
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (ctx.el.requestFullscreen) ctx.el.requestFullscreen().catch(function () { ctx.el.classList.toggle('cb-fs'); });
    else ctx.el.classList.toggle('cb-fs');
  }
  function toggleSide(force) { ctx.sideOpen = force === undefined ? !ctx.sideOpen : !!force; ctx.renderSide();
    ctx.renderToolbar();
    if (ctx.sideOpen && innerWidth < 900) { var f = ctx.side.querySelector('button,textarea');
      if (f) setTimeout(function () {
    f.focus(); }, 60); } }
  function refreshBookmarks() { return ctx.data.listBookmarks().then(function (r) { ctx.bookmarks = r.bookmarks;
    ctx.renderToolbar(); }); }
  ctx.hideSuggest = hideSuggest; ctx.tabsMenu = tabsMenu; ctx.moreMenu = moreMenu;
    ctx.bookmarkCurrent = bookmarkCurrent; ctx.downloadCurrent = downloadCurrent;
    ctx.toggleFullscreen = toggleFullscreen; ctx.toggleSide = toggleSide; ctx.refreshBookmarks = refreshBookmarks;
}
