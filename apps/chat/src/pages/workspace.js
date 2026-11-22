/* Colon AI · Workspace (v0.25.0, Workspace step 1; plan: docs/workspace/plan.md): a chat-first website builder.
   The list (#/workspace: bar, search, rows, "New workspace" pill with a template sheet) and one workspace (#/w/:id)
   with six tabs: Chat (default; v0.26.0, components/workspace-chat.js), Preview, Code, Files and Terminal (v0.27.0,
   step 3: workspace-preview.js, workspace-code.js, workspace-files.js, workspace-term.js) and Publish (step 4).
   Signed-in only. Reuses the Projects markup (components/project-ui.js) and its styles (chat-projects.css) plus
   chat-workspace.css. */
import { Colon } from '../../../../packages/ui/js/colon.js';
import * as UI from '../components/project-ui.js';
import { CW } from '../core/cw.js';
import { mount as mountChat } from '../components/workspace-chat.js';
import { mount as mountPreview } from '../components/workspace-preview.js';
import { mount as mountCode } from '../components/workspace-code.js';
import { mount as mountFiles } from '../components/workspace-files.js';
import { mount as mountTerm } from '../components/workspace-term.js';

var C = Colon, icon = C.icon, esc = C.esc;
CW.pages = CW.pages || {};
var TABS = [['chat', 'Chat', 'chat'], ['preview', 'Preview', 'eye'], ['code', 'Code', 'code'],
  ['files', 'Files', 'folder'], ['term', 'Terminal', 'terminal'], ['publish', 'Publish', 'globe']];
var SITE = 'apparatus.name.ng/';

function fail(e) {
  C.toast(e.message, 'bad', e.code === 'quota' ? { label: 'See plans', fn: function () { C.go('/account/plan'); } }
    : undefined);
}
function siteName(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
    || 'my-site';
}
function wsRow(w) {
  return '<a class="px-row" role="listitem" href="#/w/' + encodeURIComponent(w.id) + '"><b>' + esc(w.title)
    + '</b><small>' + esc(UI.plural(w.files, 'file')) + ' · Edited ' + esc(UI.rel(w.updated_at))
    + (w.published ? ' · Live' : '') + '</small></a>';
}

function newWorkspace(templates) {
  var pick = 'blank';
  C.sheet('<form class="px-sheet wk-new" novalidate><h2 class="h3">New workspace</h2><p class="small muted">Name '
    + 'your site and pick a starting point. You can change everything later.</p><input class="input" data-t '
    + 'maxlength="80" required aria-label="Workspace name" placeholder="e.g. My portfolio"><div class="wk-tpls" '
    + 'role="radiogroup" aria-label="Template">' + templates.map(function (t) {
      return '<button type="button" class="wk-tpl" role="radio" data-tpl="' + esc(t.id) + '" aria-checked="'
        + (t.id === pick) + '"><b>' + esc(t.name) + '</b><small>' + esc(t.about) + '</small></button>';
    }).join('') + '</div><div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel'
    + '</button><button type="submit" class="btn primary">Create</button></div></form>', function (el, close) {
    var form = el.querySelector('form'), input = el.querySelector('[data-t]');
    setTimeout(function () { input.focus(); }, 50);
    el.querySelectorAll('[data-tpl]').forEach(function (b) { b.addEventListener('click', function () {
      pick = b.getAttribute('data-tpl');
      el.querySelectorAll('[data-tpl]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
    }); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = input.value.trim();
      if (!title) { input.focus(); return; }
      CW.data.createWorkspace({ title: title, template: pick }).then(function (d) {
        close(); C.go('/w/' + encodeURIComponent(d.workspace.id));
      }).catch(fail);
    });
  }, { label: 'New workspace' });
}

CW.pages.workspace = function (page) {
  var data = CW.data, all = [], templates = [];
  page.innerHTML = '<div class="cw-screen px-screen">' + UI.bar('<button class="icon-btn" type="button" '
    + 'data-a="sidebar" aria-label="Menu">' + icon('menu') + '</button>', 'Workspace', '<span></span>')
    + '<p class="wk-intro">Build a website by chatting with Colon, preview it, then publish it to its own link.</p>'
    + '<label class="px-search">' + icon('search') + '<input type="search" data-q placeholder="Search workspaces" '
    + 'aria-label="Search workspaces" autocomplete="off"></label><div class="px-list" role="list">'
    + UI.skeletonHtml(3) + '</div>' + UI.fab('data-new', 'New workspace') + '</div>';
  var box = page.querySelector('.px-list'), q = page.querySelector('[data-q]');
  if (!data.listWorkspaces) { box.innerHTML = '<p class="px-empty">Log in to use Workspace.</p>'; return; }
  function render() {
    var term = q.value.trim().toLowerCase();
    var list = all.filter(function (w) { return !term || w.title.toLowerCase().indexOf(term) > -1; });
    box.innerHTML = list.length ? list.map(wsRow).join('') : '<p class="px-empty">' + (all.length
      ? 'No workspaces match “' + esc(q.value.trim()) + '”.' : 'No workspaces yet. Start one and describe the '
      + 'website you want.') + '</p>';
  }
  page.querySelector('[data-new]').addEventListener('click', function () { newWorkspace(templates); });
  q.addEventListener('input', render);
  data.listWorkspaces().then(function (d) { all = d.workspaces || []; templates = d.templates || []; render(); })
    .catch(function (e) {
      box.innerHTML = '<p class="px-empty">Workspaces didn’t load. ' + esc(e.message) + '</p>';
    });
};

/* ---------- One workspace ---------- */
function soon(ico, title, body) {
  return '<div class="wk-soon">' + icon(ico) + '<b>' + esc(title) + '</b><p>' + esc(body) + '</p></div>';
}
function publishHtml(st) {
  var w = st.workspace;
  return '<div class="wk-pub"><small>YOUR SITE’S ADDRESS</small><b>' + esc(SITE + (w.published ? w.published.name
    : siteName(w.title)) + '/') + '</b><span class="px-badge">' + (w.published ? 'Live' : 'Not published yet')
    + '</span></div>' + soon('globe', 'Publishing is coming', 'One tap will put this site live at the address '
    + 'above. You’ll be able to republish after changes or take it down.');
}

CW.pages.workspaceOne = function (page, ctx) {
  var data = CW.data, id = ctx && ctx.workspaceId, st = { tab: 'chat' }, cur = null;
  var back = '<a class="icon-btn" href="#/workspace" aria-label="All workspaces">' + icon('left') + '</a>';
  page.innerHTML = '<div class="cw-screen px-screen">' + UI.bar(back, '', '') + '<div class="skel px-skel-t"></div>'
    + '<div class="px-cards"><div class="skel px-skel-c"></div></div></div>';
  function load() {
    return data.getWorkspace(id).then(function (d) { st.workspace = d.workspace; st.files = d.files; render(); })
      .catch(function (e) { page.innerHTML = '<div class="cw-screen px-screen">' + UI.bar(back, '', '')
        + '<p class="px-empty">' + esc(e.message) + '</p></div>'; });
  }
  function quiet() {   // files changed from a tab: refresh what the other tabs show, without redrawing this one
    return data.getWorkspace(id).then(function (d) { st.workspace = d.workspace; st.files = d.files; })
      .catch(function () {});
  }
  function go(tab, extra) {
    var ask = cur && cur.ask ? cur.ask() : Promise.resolve(true);
    ask.then(function (ok) { if (!ok) return; Object.assign(st, extra || {}); st.tab = tab; render(); });
  }
  function render() {
    var w = st.workspace;
    if (cur && cur.dispose) cur.dispose();
    cur = null;
    page.innerHTML = '<div class="cw-screen px-screen wk-one wk-on-' + st.tab + '">' + UI.bar(back, w.title,
      '<button class="icon-btn" type="button" data-wmore aria-label="Workspace options" aria-haspopup="menu">'
      + icon('more') + '</button>') + '<div class="wk-tabs" role="tablist">' + TABS.map(function (t) {
      return '<button type="button" role="tab" class="wk-tab" data-tab="' + t[0] + '" aria-selected="'
        + (st.tab === t[0]) + '">' + icon(t[2]) + '<span>' + t[1] + '</span></button>';
    }).join('') + '</div><div class="wk-pane" role="tabpanel" data-pane>' + (st.tab === 'publish' ? publishHtml(st)
      : '') + '</div></div>';
    var pane = page.querySelector('[data-pane]'), o = { id: id, data: data };
    page.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () {
      if (b.getAttribute('data-tab') !== st.tab) go(b.getAttribute('data-tab')); }); });
    page.querySelector('[data-wmore]').addEventListener('click', function (e) { menu(e.currentTarget); });
    if (st.tab === 'chat') {
      cur = mountChat(pane, Object.assign(o, { onChanged: quiet, send: st.send }));
      st.send = null;
    } else if (st.tab === 'preview') {
      cur = mountPreview(pane, Object.assign(o, { page: st.page, onPage: function (p) { st.page = p; },
        onFix: function (text) { go('chat', { send: text }); } }));
    } else if (st.tab === 'code') {
      cur = mountCode(pane, Object.assign(o, { files: st.files, path: st.codePath, onSaved: quiet,
        onPath: function (p) { st.codePath = p; } }));
    } else if (st.tab === 'files') {
      mountFiles(pane, Object.assign(o, { files: st.files, onChanged: function () { quiet().then(render); },
        onEdit: function (p) { go('code', { codePath: p }); } }));
    } else if (st.tab === 'term') {
      cur = mountTerm(pane, Object.assign(o, { onChanged: quiet,
        onOpen: function (p) { go('preview', { page: p }); } }));
    }
  }
  function menu(anchor) {
    var w = st.workspace;
    C.menu(anchor, [{ label: 'Rename', icon: 'edit', onClick: function () {
      C.prompt({ title: 'Rename workspace', label: 'Name', value: w.title, max: 80 }).then(function (t) {
        if (t && t !== w.title) data.updateWorkspace(id, { title: t }).then(load).catch(fail); });
    } }, '-', { label: 'Delete', icon: 'trash', danger: true, onClick: function () {
      C.confirm({ title: 'Delete “' + w.title + '”?', body: 'Its files and history are deleted for good.',
        confirm: 'Delete workspace', danger: true }).then(function (ok) {
        if (ok) data.deleteWorkspace(id).then(function () { C.go('/workspace'); }).catch(fail); });
    } }], { align: 'right', label: 'Workspace options' });
  }
  load();
};
