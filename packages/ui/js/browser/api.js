/* ColonBrowser · the public instance API returned by ColonBrowser.create(). */

import { Colon } from '../colon.js';

var C = Colon, icon = C.icon, esc = C.esc;

export function buildApi(ctx) {
  ctx.api = {
    ready: ctx.ready, el: ctx.el, navigate: function (u) { return ctx.ready.then(function () { return ctx.navigate(u,
      { force: true });
      }); },
    back: ctx.back, forward: ctx.forward, reload: ctx.reload, home: ctx.home, newTab: ctx.newTab,
      closeTab: ctx.closeTab, switchTab: ctx.switchTab,
    setControl: ctx.setControl, takeControl: ctx.takeControl, returnToAI: ctx.returnToAI, pauseAI: ctx.pauseAI,
      stopTask: ctx.stopTask,
      startTask: function (g) { return ctx.ready.then(function () { ctx.startTask(g); }); },
    toggleSide: ctx.toggleSide, toggleFullscreen: ctx.toggleFullscreen, on: ctx.on,
      refreshBookmarks: ctx.refreshBookmarks, data: ctx.data,
    settings: function () { return ctx.settings; },
    reloadSettings: function () { return ctx.data.getSettings().then(function (s) { ctx.settings = s;
      ctx.renderViewport(); }); },
    state: function () { if (!ctx.session) return null; var t = ctx.active(); return { tabs: ctx.session.tabs.map(
      function (x) {
      return { id: x.id, url: x.url, title: x.title, active: x.id === ctx.session.active_id, status: ctx.pages[x.id]
        ? ctx.pages[
      x.id].status : 'idle' }; }), active: t && { id: t.id, url: t.url, title: t.title }, control: ctx.session.control,
      task: ctx.runner.state(), loading: !!(t && ctx.pages[t.id] && ctx.pages[t.id].status === 'loading') }; },
    page: function () { var t = ctx.active(); return t && ctx.pages[t.id] && ctx.pages[t.id].page; },
    // re-parent: session and page state are kept
    mount: function (c) { if (c && ctx.el.parentNode !== c) c.appendChild(ctx.el); },
    editBookmark: function (bm) {
      ctx.data.listBookmarks().then(function (r) {
        C.sheet('<div class="h2">Edit bookmark</div><form class="form" style="margin-top:12px" novalidate>' +
          '<div class="field"><label for="bm-t">Title</label><input class="input" id="bm-t" maxlength="200" value="'
            + esc(bm.title) + '"></div>' +
          ('<div class="field"><label for="bm-f">Folder</label><select class="select" id="bm-f"><option value="">No '
            + 'folder</option>') + r.folders.map(function (f) { return '<option value="' + esc(f.id) + '"'
            + (f.id === bm.folder_id ? ' selected' : '') + '>' + esc(f.name) + '</option>';
            }).join('') + '</select></div>' +
          '<div class="tiny muted mono cb-ellipsis">' + esc(bm.url) + '</div>' +
          '<div class="sheet-actions"><button type="button" class="btn danger" data-del>' + icon('trash')
            + 'Remove</button><button class="btn primary" type="submit">Save</button></div></form>', function (sh,
            close) {
          sh.querySelector('form').addEventListener('submit', function (e) { e.preventDefault();
            ctx.data.updateBookmark(
            bm.id, { title: sh.querySelector('#bm-t').value.trim() || bm.url, folder_id: sh.querySelector(
            '#bm-f').value || null }).then(function () { close(); C.toast('Bookmark saved.', 'ok');
              ctx.refreshBookmarks();
            ctx.emit('bookmarks'); }); });
          sh.querySelector('[data-del]').addEventListener('click', function () { ctx.data.removeBookmark(bm.id).then(
            function () { close(); C.toast('Bookmark removed.'); ctx.refreshBookmarks(); ctx.emit('bookmarks'); }); });
        }, { label: 'Edit bookmark' });
      });
    },
    destroy: function () { ctx.destroyed = true; clearInterval(ctx.timer); ctx.runner.stop(); ctx.el.remove(); }
  };
}
