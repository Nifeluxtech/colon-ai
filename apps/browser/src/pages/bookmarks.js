/* Colon Browser · Bookmarks section (folders, edit, import/export). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { errBox, fav, head, openUrl, render } from '../components/chrome.js';
import { S } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, U = ColonURL;

function bookmarksPage(box) {
  var filter = box.getAttribute('data-folder') || 'all';
  box.innerHTML = head('Bookmarks', 'Pages you saved, organised in folders.',
    '<button class="btn sm" data-addfolder>' + icon('folder')
    + 'New folder</button><button class="btn primary sm" data-addcur>' + icon('bookmark')
    + 'Save current page</button>') + '<div class="skel" style="height:120px"></div>';
  S.data.listBookmarks().then(function (r) {
    var list = r.bookmarks.filter(function (b) { return filter === 'all' || (filter === 'none'
      ? !b.folder_id : b.folder_id === filter); });
    var folderName = function (id) { var f = r.folders.filter(function (x) { return x.id === id; })[0];
      return f ? f.name : ''; };
    box.querySelector('.skel').outerHTML = '<div class="chips bw-folders" role="group" aria-label="Folders">' +
      [['all', 'All (' + r.bookmarks.length + ')'], ['none', 'Unfiled']].concat(r.folders.map(function (f) { return [
        f.id, f.name]; })).map(function (f) {
        var isF = f[0] !== 'all' && f[0] !== 'none';
        return '<span class="bw-folder' + (filter === f[0] ? ' on' : '') + '"><button class="chip sm" aria-pressed="'
          + (filter === f[0]) + '" data-folder="' + esc(f[0]) + '">' + (isF ? icon('folder') : '') + esc(f[1])
          + '</button>' + (isF && filter === f[0] ? '<button class="icon-btn sm" data-folder-menu="' + esc(f[0])
          + '" aria-label="Folder options">' + icon('more') + '</button>' : '') + '</span>';
      }).join('') + '</div>' +
      (list.length ? '<div class="list">' + list.map(function (b) {
        return '<div class="bw-row">' + fav(b.url) + '<a href="' + esc(b.url) + '" data-open="' + esc(b.url)
          + '" class="bw-row-main"><b>' + esc(b.title) + '</b><small>' + esc(U.displayUrl(b.url)) + (b.folder_id
          ? ' · ' + esc(folderName(b.folder_id)) : '') + '</small></a>' +
          '<button class="icon-btn sm" data-bm="' + esc(b.id) + '" aria-label="Options for ' + esc(b.title)
            + '" aria-haspopup="menu">' + icon('more') + '</button></div>';
      }).join('') + '</div>' : '<div class="card empty">' + icon('bookmark') + '<div class="h3">'
        + (r.bookmarks.length ? 'No bookmarks in this folder' : 'No bookmarks yet')
        + '</div><p class="small">Tap the bookmark icon in the address bar to save a page.</p></div>');
    box.querySelectorAll('[data-folder]').forEach(function (b) { b.addEventListener('click', function () {
      box.setAttribute('data-folder', b.getAttribute('data-folder')); render('bookmarks'); }); });
    box.querySelectorAll('[data-open]').forEach(function (a) { a.addEventListener('click', function (e) {
      e.preventDefault(); openUrl(a.getAttribute('data-open')); }); });
    box.querySelectorAll('[data-bm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var bm = r.bookmarks.filter(function (x) { return x.id === btn.getAttribute('data-bm'); })[0];
        C.menu(btn, [
          { label: 'Open', icon: 'globe', onClick: function () { openUrl(bm.url); } },
          { label: 'Open in new tab', icon: 'tabs', onClick: function () { C.go('/'); S.inst.newTab(bm.url); } },
          { label: 'Edit title or folder', icon: 'edit', onClick: function () { S.inst.editBookmark(bm); } }, '-',
          { label: 'Delete', icon: 'trash', danger: true, onClick: function () { C.confirm({
            title: 'Delete bookmark?', body: '“' + bm.title + '” will be removed.', confirm: 'Delete',
            danger: true }).then(function (ok) { if (ok) S.data.removeBookmark(bm.id).then(function () { C.toast(
            'Bookmark deleted.'); S.inst.refreshBookmarks(); render('bookmarks'); }); }); } }
        ], { align: 'right' });
      });
    });
    var fm = box.querySelector('[data-folder-menu]');
    if (fm) fm.addEventListener('click', function () {
      var f = r.folders.filter(function (x) { return x.id === fm.getAttribute('data-folder-menu'); })[0];
      C.menu(fm, [
        { label: 'Rename folder', icon: 'edit', onClick: function () { C.prompt({ title: 'Rename folder',
          label: 'Name', value: f.name, max: 60 }).then(function (v) { if (v) S.data.renameFolder(f.id,
          v).then(function () { render('bookmarks'); }); }); } },
        { label: 'Delete folder', icon: 'trash', danger: true, onClick: function () { C.confirm({ title: 'Delete “'
          + f.name + '”?', body: 'Its bookmarks move to Unfiled.', confirm: 'Delete folder', danger: true }).then(
          function (ok) { if (ok) S.data.removeFolder(f.id).then(function () { box.setAttribute('data-folder',
          'all'); render('bookmarks'); }); }); } }
      ]);
    });
  }).catch(function (e) { errBox(box, e, function () { render('bookmarks'); }); });
  box.querySelector('[data-addfolder]').addEventListener('click', function () {
    C.prompt({ title: 'New folder', label: 'Folder name', placeholder: 'e.g. School, Work, Recipes', max: 60,
      confirm: 'Create' }).then(function (v) { if (v) S.data.addFolder(v).then(function (f) { box.setAttribute(
      'data-folder', f.id); render('bookmarks'); C.toast('Folder created.', 'ok'); }); });
  });
  box.querySelector('[data-addcur]').addEventListener('click', function () {
    var st = S.inst.state();
    if (/^colon:/.test(st.active.url)) return C.toast('Open a page first, then save it.');
    S.data.addBookmark({ url: st.active.url, title: st.active.title, folder_id: (filter !== 'all'
      && filter !== 'none') ? filter : null }).then(function () { S.inst.refreshBookmarks(); render('bookmarks');
      C.toast('Page saved.', 'ok'); });
  });
}

export { bookmarksPage };
