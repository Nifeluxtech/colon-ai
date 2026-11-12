/* Colon Browser · standalone app shell: navigation (Home, Tabs, Bookmarks, History, Downloads,
   AI Browse, Settings, Help) around the shared ColonBrowser module. All state goes through
   ColonBrowserData (packages/ui/assets/colon-browser-data.js). */
import { Colon } from '../../../packages/ui/js/colon.js';
import { ColonBrowser } from '../../../packages/ui/js/browser/index.js';
import { ColonBrowserData } from '../../../packages/ui/js/browser/data.js';
import { ColonURL } from '../../../packages/ui/js/url.js';

var C = Colon, icon = C.icon, esc = C.esc, U = ColonURL;
var B = window.CB = window.CB || {};
var S = { el: null, inst: null, section: 'home', data: null };
var NAV = [['home', '/', 'home', 'Home'], ['tabs', '/tabs', 'tabs', 'Tabs'], ['bookmarks', '/bookmarks', 'bookmark',
  'Bookmarks'], ['history', '/history', 'history', 'History'],
  ['downloads', '/downloads', 'download', 'Downloads'], ['ai', '/ai', 'sparkles', 'AI Browse'], ['settings',
    '/settings', 'settings', 'Settings'], ['help', '/help', 'help', 'Help']];
var UPLOAD_TYPES = new RegExp(
  String.raw`^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/|application\/(json|msword|vnd\.openxmlformats|`
  + String.raw`vnd\.oasis|rtf))`);
var UPLOAD_EXT = /\.(png|jpe?g|webp|gif|pdf|txt|md|csv|json|docx?|odt|rtf|xlsx?|pptx?)$/i;
var UPLOAD_MAX = 20 * 1048576;

function $(s) { return S.el.querySelector(s); }
function isMobile() { return innerWidth < 900; }

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

var PAGES = {
  tabs: function (box) {
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
  },

  bookmarks: function (box) {
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
  },

  history: function (box) {
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
  },

  downloads: function (box) {
    box.innerHTML = head('Downloads', 'Saved pages and files, plus files you upload.', '') +
      '<div class="section-title">Downloads</div><div class="bw-dl"><div class="skel" style="height:80px"></div></div>'
        +
      ('<div class="section-title">Uploads</div><div class="bw-drop" tabindex="0" role="button" aria-label="Choose '
        + 'files to upload">') + icon('upload')
        + ('<b>Choose files or drop them here</b><span class="small muted">Images, PDFs, documents and text · up to '
        + '20 MB each</span><input type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,appl'
        + 'ication/pdf,.txt,.md,.csv,.json,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ppt,.pptx"></div>') +
      '<div class="bw-up-progress"></div><div class="bw-up"></div>';
    function loadDl() {
      var out = box.querySelector('.bw-dl');
      S.data.listDownloads().then(function (list) {
        if (!list.length) { out.innerHTML = '<div class="card empty">' + icon('download')
          + ('<div class="h3">No downloads yet</div><p class="small">Use the download button in the toolbar to save '
          + 'a page for offline reading.</p></div>'); return; }
        out.innerHTML = '<div class="list">' + list.map(function (d) {
          var ext = (d.name.split('.').pop() || '').toUpperCase();
          return '<div class="bw-row"><span class="bw-fileico">' + esc(ext.slice(0,
            4)) + '</span><span class="bw-row-main"><b>' + esc(d.name) + '</b><small>' + esc(d.type) + ' · '
            + C.fmtBytes(d.size || 0) + ' · ' + C.ago(d.created_at) + '</small></span>' +
            '<span class="badge ' + (d.status === 'complete' ? 'ok' : d.status === 'failed' ? 'bad' : '') + '">'
              + esc(d.status === 'complete' ? 'Complete' : d.status) + '</span>' +
            (d.has_file ? '<button class="icon-btn sm" data-dl-open="' + esc(d.id) + '" aria-label="Open '
              + esc(d.name) + '" data-tip="Open">' + icon('external')
              + '</button><button class="icon-btn sm" data-dl-save="' + esc(d.id) + '" aria-label="Save ' + esc(d.name)
              + ' again" data-tip="Save again">' + icon('download') + '</button>' : '') +
            '<button class="icon-btn sm" data-dl-rm="' + esc(d.id) + '" aria-label="Remove ' + esc(d.name)
              + '" data-tip="Remove">' + icon('x') + '</button></div>';
        }).join('') + '</div>';
        out.querySelectorAll('[data-dl-open]').forEach(function (b) { b.addEventListener('click', function () {
          S.data.getDownloadFile(b.getAttribute('data-dl-open')).then(function (blob) { if (!blob) return C.toast(
          'File not found on this device.', 'bad'); window.open(URL.createObjectURL(blob), '_blank', 'noopener'); });
          }); });
        out.querySelectorAll('[data-dl-save]').forEach(function (b) { b.addEventListener('click', function () { var d =
          list.filter(function (x) { return x.id === b.getAttribute('data-dl-save'); })[0]; S.data.getDownloadFile(
          d.id).then(function (blob) { if (blob) ColonBrowser.saveBlob(blob, d.name); }); }); });
        out.querySelectorAll('[data-dl-rm]').forEach(function (b) { b.addEventListener('click', function () {
          S.data.removeDownload(b.getAttribute('data-dl-rm')).then(function () { C.toast('Removed.'); loadDl(); }); });
          });
      }).catch(function (e) { errBox(out, e, loadDl); });
    }
    function loadUp() {
      var out = box.querySelector('.bw-up');
      S.data.listUploads().then(function (list) {
        out.innerHTML = list.length ? '<div class="list" style="margin-top:10px">' + list.map(function (u) {
          return '<div class="bw-row"><span class="bw-fileico">' + esc((u.name.split('.').pop() || '').toUpperCase(
            ).slice(0, 4)) + '</span><span class="bw-row-main"><b>' + esc(u.name) + '</b><small>' + C.fmtBytes(u.size)
            + ' · ' + C.ago(u.created_at) + '</small></span><span class="badge ok">Uploaded</span>' +
            '<button class="icon-btn sm" data-up-rm="' + esc(u.id) + '" aria-label="Remove ' + esc(u.name) + '">'
              + icon('x') + '</button></div>';
        }).join('') + '</div>' : '';
        out.querySelectorAll('[data-up-rm]').forEach(function (b) { b.addEventListener('click', function () {
          S.data.removeUpload(b.getAttribute('data-up-rm')).then(loadUp); }); });
      }).catch(function () {});
    }
    var drop = box.querySelector('.bw-drop'), input = drop.querySelector('input'), prog = box.querySelector(
      '.bw-up-progress');
    function upload(files) {
      Array.prototype.forEach.call(files, function (f) {
        var row = document.createElement('div'); row.className = 'bw-row bw-uprow';
        var okType = UPLOAD_TYPES.test(f.type) || UPLOAD_EXT.test(f.name);
        var err = !okType ? 'Unsupported file type. Use images, PDFs, documents or text.' : f.size > UPLOAD_MAX
          ? 'Too large: ' + C.fmtBytes(f.size) + ' (max 20 MB).' : !f.size ? 'This file is empty.' : null;
        row.innerHTML = '<span class="bw-fileico">' + esc((f.name.split('.').pop() || '').toUpperCase().slice(0,
          4)) + '</span><span class="bw-row-main"><b>' + esc(f.name) + '</b>' + (err
          ? '<small style="color:var(--bad)">' + esc(err) + '</small>' : '<span class="progress"><i></i></span>')
          + '</span>' +
          (err ? '<span class="badge bad">Not uploaded</span>' : '<span class="badge" data-pct>0%</span>')
            + '<button class="icon-btn sm" aria-label="Dismiss">' + icon('x') + '</button>';
        prog.appendChild(row);
        row.querySelector('button').addEventListener('click', function () { row.remove(); });
        if (err) return;
        S.data.upload(f, function (p) { row.querySelector('.progress i').style.width = Math.round(p * 100) + '%';
          row.querySelector('[data-pct]').textContent = Math.round(p * 100) + '%'; })
          .then(function () { row.remove(); C.toast('“' + f.name + '” uploaded.', 'ok'); loadUp(); },
            function (e) { var b = row.querySelector('[data-pct]'); b.textContent = 'Failed';
              b.className = 'badge bad'; row.querySelector('.progress').outerHTML = '<small style="color:var(--bad)">'
              + esc(e.message) + '</small>'; });
      });
    }
    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault();
      input.click(); } });
    input.addEventListener('change', function () { upload(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault();
      drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over');
      }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) upload(
      e.dataTransfer.files); });
    loadDl(); loadUp();
  },

  settings: function (box) {
    box.innerHTML = head('Settings', 'Your browser, your rules.', '') + '<div class="skel" style="height:200px"></div>';
    S.data.getSettings().then(function (s) {
      var engines = Object.keys(U.ENGINES).map(function (k) { return [k, U.ENGINES[k].name]; });
      function sel(name, label, sub, v,
        opts) { return '<div class="set-row stack"><span class="body"><label class="title" for="bs-' + name + '">'
        + esc(label) + '</label>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '')
        + '</span><select class="select" id="bs-' + name + '" data-s="' + name + '">' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></div>'; }
      function tog(name, label, sub, v) { return '<label class="set-row"><span class="body"><span class="title">'
        + esc(label) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '')
        + '</span><span class="switch"><input type="checkbox" data-s="' + name + '"' + (v ? ' checked' : '')
        + ' aria-label="' + esc(label) + '"><i></i></span></label>'; }
      function perm(k, label) { return sel('perm.' + k, label, '', s.permissions[k], [['ask', 'Ask'], ['allow',
        'Allow'], ['block', 'Block']]); }
      var custom = s.homepage !== 'colon://newtab';
      box.querySelector('.skel').outerHTML =
        '<div class="section-title">General</div><div class="list">' +
        ('<div class="set-row stack"><span class="body"><span class="title">Homepage</span><span class="sub">What '
          + 'the Home button opens.</span></span><div class="seg" role="group" aria-label="Homepage"><button '
          + 'type="button" data-home="new" aria-pressed="') + !custom
          + '">New tab page</button><button type="button" data-home="custom" aria-pressed="' + custom
          + '">Custom page</button></div></div>' +
        '<form class="set-row stack" data-homeform' + (custom ? '' : ' hidden')
          + (' novalidate><span class="body"><label class="title" for="bs-homeurl">Homepage '
          + 'address</label></span><span class="set-inline"><input class="input" id="bs-homeurl" inputmode="url" '
          + 'value="') + esc(custom ? s.homepage : '')
          + '" placeholder="https://en.wikipedia.org"><button class="btn sm" type="submit">Save</button></span></form>'
          +
        sel('engine', 'Search engine', 'Used for searches from the address bar.', s.engine, engines) + '</div>' +
        '<div class="section-title">Appearance</div><div class="list">' +
        ('<div class="set-row stack"><span class="body"><span class="title">Theme</span></span><div class="seg" '
          + 'role="group" aria-label="Theme">') + [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system',
          'Auto', 'devices']].map(function (t) { return '<button type="button" data-theme-set="' + t[0]
          + '" aria-pressed="' + (C.theme.get() === t[0]) + '">' + icon(t[2]) + t[1] + '</button>';
          }).join('') + '</div></div>' +
        sel('readerFont', 'Reader text size', '', s.readerFont, [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']])
          + '</div>' +
        '<div class="section-title">Privacy</div><div class="list">' +
        tog('saveHistory', 'Save browsing history', 'Turn off to stop recording pages you visit.', s.saveHistory) +
        tog('loadImages', 'Load images', 'Turn off to save data on slow networks.', s.loadImages) +
        tog('blockTrackers', 'Block trackers',
          'Reader preview never runs page scripts. The Android app blocks known trackers.', s.blockTrackers) +
        tog('doNotTrack', 'Send “Do Not Track”', 'Applies in the Colon Android app.', s.doNotTrack) + '</div>' +
        '<div class="section-title">Site permissions</div><div class="list">' + perm('microphone', 'Microphone') + perm(
          'camera', 'Camera') + perm('location', 'Location') + perm('notifications', 'Notifications') +
        ('<div class="set-row"><span class="body"><span class="sub">Reader preview never gives sites access to '
          + 'these. Your choices apply to full browsing in the Colon Android app.</span></span></div></div>') +
        '<div class="section-title">Downloads</div><div class="list">' + tog('askWhereToSave',
          'Ask where to save each file', '', s.askWhereToSave) + tog('downloadOpenAfter',
          'Open files after downloading', '', s.downloadOpenAfter) + '</div>' +
        '<div class="section-title">Sessions and AI</div><div class="list">' + tog('restoreSession',
          'Restore tabs when you return', 'Reopen your last tabs, history and control mode.', s.restoreSession) +
        sel('aiApproval', 'When Saga browses in AI mode', 'Shared mode always asks before every action.', s.aiApproval,
          [['sensitive', 'Ask before sensitive actions'], ['always', 'Ask before every action']]) +
        '<div class="set-row"><span class="body"><span class="title">Where your data lives</span><span class="sub">'
          + esc(S.data.describe) + '</span></span></div></div>' +
        '<div class="section-title">Clear browsing data</div><div class="list"><form class="bw-clear" novalidate>' +
        [['history', 'Browsing history'], ['downloads', 'Downloads and uploads list'], ['session',
          'Open tabs and session'], ['bookmarks', 'Bookmarks and folders'], ['settings', 'Browser settings']].map(
          function (c, i) { return '<label class="check"><input type="checkbox" name="' + c[0] + '"' + (i < 2
          ? ' checked' : '') + '> <span>' + c[1] + '</span></label>'; }).join('') +
        '<button class="btn danger" type="submit">' + icon('trash') + 'Clear selected data</button></form></div>' +
        ('<p class="tiny muted" style="text-align:center;margin:20px 0">Colon Browser v0.3.1 · Web reader preview · '
          + 'by Nifelux</p>');
      box.querySelectorAll('[data-s]').forEach(function (el) {
        el.addEventListener('change', function () {
          var k = el.getAttribute('data-s'), v = el.type === 'checkbox' ? el.checked : el.value, patch = {};
          if (k.indexOf('perm.') === 0) { patch.permissions = Object.assign({}, s.permissions);
            patch.permissions[k.slice(5)] = v; } else patch[k] = v;
          S.data.saveSettings(patch).then(function (n) { s = n; S.inst.reloadSettings(); C.toast('Saved.', 'ok'); });
        });
      });
      box.querySelectorAll('[data-theme-set]').forEach(function (b) { b.addEventListener('click', function () {
        C.theme.set(b.getAttribute('data-theme-set')); box.querySelectorAll('[data-theme-set]').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b); }); }); });
      var hf = box.querySelector('[data-homeform]');
      box.querySelectorAll('[data-home]').forEach(function (b) {
        b.addEventListener('click', function () {
          box.querySelectorAll('[data-home]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          if (b.getAttribute('data-home') === 'new') { hf.hidden = true; S.data.saveSettings({
            homepage: 'colon://newtab' }).then(function () { S.inst.reloadSettings();
            C.toast('Home opens a new tab page.', 'ok'); }); }
          else { hf.hidden = false; hf.querySelector('input').focus(); }
        });
      });
      hf.addEventListener('submit', function (e) {
        e.preventDefault(); var inp = hf.querySelector('input'), p = U.parseInput(inp.value, s.engine);
        var g = p && p.type === 'url' ? U.guard(p.url) : { ok: false,
          message: 'Enter a web address like https://example.com' };
        if (!g.ok) { inp.classList.add('err'); C.toast(g.message, 'bad'); return; }
        inp.classList.remove('err'); inp.value = g.url;
        S.data.saveSettings({ homepage: g.url }).then(function () { S.inst.reloadSettings(); C.toast('Homepage saved.',
          'ok'); });
      });
      box.querySelector('.bw-clear').addEventListener('submit', function (e) {
        e.preventDefault(); var what = {}; e.target.querySelectorAll('input:checked').forEach(function (i) { what[
          i.name] = true; });
        if (!Object.keys(what).length) return C.toast('Choose what to clear.');
        C.confirm({ title: 'Clear browsing data?', body: 'The selected data will be permanently removed.',
          confirm: 'Clear', danger: true }).then(function (ok) {
          if (!ok) return;
          S.data.clearData(what).then(function () { C.toast('Browsing data cleared.', 'ok'); if (what.session
            || what.settings) setTimeout(function () { location.reload(); }, 600); else { S.inst.refreshBookmarks();
            render('settings'); } });
        });
      });
    }).catch(function (e) { errBox(box, e, function () { render('settings'); }); });
  },

  help: function (box) {
    var faq = [
      ['What is “Reader preview”?',
        ('On the web, Colon Browser loads pages as data, removes scripts, trackers and forms, and shows clean text '
        + 'and images. Sites that allow it open inside the browser; others open in a new tab. It is not a full '
        + 'browser engine.')],
      ['Where is the full browser?',
        ('Full browsing, with logins and interactive sites, runs in the Colon Android app on the Android System '
        + 'WebView (ROADMAP Phase 7–8).')],
      ['What are AI, Manual and Shared modes?',
        ('AI: Saga browses for you and every action is shown. Manual: you are in control and AI automation is '
        + 'paused. Shared: Saga proposes each action and waits for your approval.')],
      ['How do I take over from Saga?',
        ('Tap Take Control at any time. Saga pauses its pending actions first, then hands you the browser. Tap '
        + 'Return to AI to let it continue.')],
      ['Is my browsing private?',
        ('Your tabs, history and bookmarks are stored for your account only. Reader preview never runs page '
        + 'scripts. You can clear data any time in Settings.')]
    ];
    box.innerHTML = head('Help', 'How Colon Browser works.', '') +
      '<div class="faq">' + faq.map(function (f) { return '<details class="faq-item"><summary>' + esc(f[0]) + icon(
        'chevDown') + '</summary><p>' + esc(f[1]) + '</p></details>'; }).join('') + '</div>' +
      '<div class="section-title">Keyboard shortcuts</div><div class="list">' + [['Ctrl + L', 'Focus the address bar'],
        ['Alt + ←', 'Back'], ['Alt + →', 'Forward'], ['← →', 'Switch tabs (when a tab is focused)']].map(function (s) {
        return '<div class="set-row"><span class="body"><span class="title">' + esc(s[1])
        + '</span></span><span class="kbd">' + esc(s[0]) + '</span></div>'; }).join('') + '</div>' +
      '<div class="section-title">Get in touch</div><div class="list">' + C.row(
        'https://github.com/Nifeluxtech/colon-ai/issues', 'alert', 'Report a problem', 'Open an issue on GitHub')
        + C.row('#/terms', 'file', 'Terms', '') + C.row('#/privacy', 'lock', 'Privacy', '') + '</div>';
    box.querySelector('a[href^="https://github.com"]').setAttribute('target', '_blank');
  }
};

B.mount = mount; B.route = route;

export { B as CB };
