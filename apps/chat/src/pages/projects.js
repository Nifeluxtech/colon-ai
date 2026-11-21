/* Colon AI · Projects (v0.15.0, Blueprint B10; v0.24.0 redesign in the Claude-app style, mobile-first from 360px):
   the list (menu, title, sort; search; plain rows "Edited <time>"; a floating "New project" pill) and one project's
   page (back, title, Private badge, the Context and Custom instructions cards, the Memory row, its chats as sessions
   and a floating "New session" pill). A project with a repository or code files starts sessions in Developer mode
   (the mode chips still switch it). How many projects a user may have comes from their plan (402 quota in enforce
   mode). Signed-in only. The Context sheet (files, repositories) is components/project-context.js. */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { openContext } from '../components/project-context.js';
import * as UI from '../components/project-ui.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;
CW.pages = CW.pages || {};
var SORT_KEY = 'colon.projects.sort';
var SORTS = [['edited', 'Last edited'], ['name', 'Name'], ['created', 'Date created']];

function fail(e) {
  C.toast(e.message, 'bad', e.code === 'quota' ? { label: 'See plans', fn: function () { C.go('/account/plan'); } }
    : undefined);
}
function pref(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private */ }
  return v;
}
function newProject() {
  C.prompt({ title: 'New project', label: 'Project name', placeholder: 'e.g. Final year thesis', max: 80,
    confirm: 'Create' }).then(function (name) {
    if (!name) return;
    CW.data.createProject({ name: name }).then(function (d) {
      if (d.over_limit) C.toast('This is more projects than your plan includes.', 'bad');
      C.go('/p/' + encodeURIComponent(d.project.id));
    }).catch(fail);
  });
}

CW.pages.projects = function (page) {
  var data = CW.data, all = [], sort = pref(SORT_KEY) || 'edited', showArchived = false;
  page.innerHTML = '<div class="cw-screen px-screen">' + UI.bar('<button class="icon-btn" type="button" '
    + 'data-a="sidebar" aria-label="Menu">' + icon('menu') + '</button>', 'Projects', '<button class="icon-btn" '
    + 'type="button" data-sort aria-label="Sort projects" aria-haspopup="menu">' + icon('filter') + '</button>')
    + '<label class="px-search">' + icon('search') + '<input type="search" data-q placeholder="Search projects" '
    + 'aria-label="Search projects" autocomplete="off"></label><div class="px-list" role="list">'
    + UI.skeletonHtml(4) + '</div>' + UI.fab('data-new', 'New project') + '</div>';
  var scr = page.querySelector('.px-screen'), box = page.querySelector('.px-list'), q = page.querySelector('[data-q]');
  if (!data.listProjects) { box.innerHTML = '<p class="px-empty">Log in to use projects.</p>'; return; }
  function render() {
    var term = q.value.trim().toLowerCase();
    var list = all.filter(function (p) { return (showArchived || !p.archived) && (!term
      || p.name.toLowerCase().indexOf(term) > -1); });
    list.sort(function (a, b) {
      if (sort === 'name') return a.name.localeCompare(b.name);
      var k = sort === 'created' ? 'created_at' : 'updated_at';
      return new Date(b[k]) - new Date(a[k]);
    });
    box.innerHTML = list.length ? list.map(UI.rowHtml).join('') : '<p class="px-empty">' + (all.length
      ? (term ? 'No projects match “' + esc(q.value.trim()) + '”.' : 'All your projects are archived.')
      : 'No projects yet. Group chats, files and instructions in one.') + '</p>';
  }
  scr.addEventListener('click', function (e) {
    if (e.target.closest('[data-new]')) return newProject();
    var s = e.target.closest('[data-sort]');
    if (s) C.menu(s, [{ head: 'Sort by' }].concat(SORTS.map(function (x) {
      return { label: x[1], icon: sort === x[0] ? 'check' : 'list', onClick: function () { sort = pref(SORT_KEY, x[0]);
        render(); } }; }), ['-', { label: showArchived ? 'Hide archived' : 'Show archived', icon: 'archive',
      onClick: function () { showArchived = !showArchived; render(); } }]), { align: 'right', label: 'Sort projects' });
  });
  q.addEventListener('input', render);
  data.listProjects().then(function (d) { all = d.projects || []; render(); }).catch(function (e) {
    box.innerHTML = '<p class="px-empty">Projects didn’t load. ' + esc(e.message) + '</p>'; });
};

CW.pages.project = function (page, ctx) {
  var data = CW.data, id = ctx && ctx.projectId, st = {};
  var back = '<a class="icon-btn" href="#/projects" aria-label="All projects">' + icon('left') + '</a>';
  page.innerHTML = '<div class="cw-screen px-screen">' + UI.bar(back, '', '') + '<div class="skel px-skel-t"></div>'
    + '<div class="px-cards"><div class="skel px-skel-c"></div><div class="skel px-skel-c"></div></div></div>';
  function load() {
    return Promise.all([data.getProject(id), data.getMemory({ projectId: id }).catch(function () { return null; })])
      .then(function (r) { st = r[0]; st.mem = r[1]; render(); })
      .catch(function (e) { page.innerHTML = '<div class="cw-screen px-screen">' + UI.bar(back, '', '')
        + '<p class="px-empty">' + esc(e.message) + '</p></div>'; });
  }
  function mems() { return st.mem ? st.mem.memories.filter(function (m) { return m.scope === 'project'; }) : []; }
  function render() {
    var p = st.project;
    page.innerHTML = '<div class="cw-screen px-screen px-detail">' + UI.bar(back, '', '<button class="icon-btn" '
      + 'type="button" data-pmore aria-label="Project options" aria-haspopup="menu">' + icon('more') + '</button>')
      + '<h1 class="px-title">' + esc(p.name) + '</h1><span class="px-badge">' + icon('lock') + 'Private</span>'
      + (p.archived ? '<span class="px-badge">' + icon('archive') + 'Archived</span>' : '')
      + UI.cardsHtml(p, st.files) + UI.memoryRow(mems().length)
      + '<h2 class="px-h">Sessions</h2><div class="px-sessions">' + (st.chats.length
        ? st.chats.map(UI.sessionRow).join('') : '<p class="px-empty">No sessions yet.</p>') + '</div>'
      + UI.fab('data-pchat', 'New session') + '</div>';
    bind(p);
  }
  function bind(p) {
    var $ = function (s) { return page.querySelector(s); };
    $('[data-pchat]').addEventListener('click', function () {
      var dev = UI.isCodeProject(p, st.files);
      data.createConversation({ mode: dev ? 'developer' : (CW.S.settings && CW.S.settings.defaultMode) || 'general',
        project_id: p.id }).then(function (c) { if (CW.refreshConvs) CW.refreshConvs();
        C.go('/c/' + encodeURIComponent(c.id)); }).catch(fail);
    });
    $('[data-pmore]').addEventListener('click', function (e) { projectMenu(e.currentTarget, p); });
    $('[data-ctx]').addEventListener('click', function () { openContext(p, st.files, load); });
    $('[data-inst]').addEventListener('click', function () { editInstructions(p); });
    $('[data-mem]').addEventListener('click', function () { memorySheet(p); });
  }
  function projectMenu(anchor, p) {
    C.menu(anchor, [{ label: 'Rename', icon: 'edit', onClick: function () {
      C.prompt({ title: 'Rename project', label: 'Project name', value: p.name, max: 80 }).then(function (name) {
        if (name && name !== p.name) data.updateProject(p.id, { name: name }).then(load).catch(fail); });
    } }, { label: p.archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: function () {
      data.updateProject(p.id, { archived: !p.archived }).then(function () {
        C.toast(p.archived ? 'Project restored.' : 'Project archived.', 'ok'); load(); }).catch(fail);
    } }, '-', { label: 'Delete', icon: 'trash', danger: true, onClick: function () {
      C.confirm({ title: 'Delete “' + p.name + '”?', body: 'Its chats and files stay and move back to your chat '
        + 'list. Its instructions, project memories and connected repository are deleted.', confirm: 'Delete project',
      danger: true }).then(function (ok) { if (ok) data.deleteProject(p.id).then(function () { C.go('/projects'); })
        .catch(fail); });
    } }], { align: 'right', label: 'Project options' });
  }
  function editInstructions(p) {
    C.sheet('<div class="px-sheet"><h2 class="h3">Custom instructions</h2><p class="small muted">Colon follows these '
      + 'in every chat in this project.</p><textarea class="textarea" rows="7" maxlength="4000" data-t aria-label='
      + '"Custom instructions" placeholder="e.g. I study nursing at UI. Explain simply and cite sources.">'
      + esc(p.instructions) + '</textarea><div class="sheet-actions"><button type="button" class="btn ghost" '
      + 'data-close>Cancel</button><button type="button" class="btn primary" data-save>Save</button></div></div>',
    function (el, close) {
      el.querySelector('[data-save]').addEventListener('click', function () {
        data.updateProject(p.id, { instructions: el.querySelector('[data-t]').value }).then(function () {
          close(); C.toast('Instructions saved.', 'ok'); load(); }).catch(fail);
      });
    }, { label: 'Custom instructions' });
  }
  function memorySheet(p) {
    var on = st.mem && st.mem.memory.enabled;
    C.sheet('<div class="px-sheet"><h2 class="h3">Memory</h2><p class="small muted">What Colon remembers in this '
      + 'project only.</p>' + (on ? '<form class="px-memadd" novalidate><input class="input" maxlength="1000" '
      + 'aria-label="New project memory" placeholder="Something Colon should remember here"><button class="btn" '
      + 'type="submit">Add</button></form>' : '<p class="px-note">Memory is off. <a class="link" href="#/memory">'
      + 'Turn it on</a> to keep project memories.</p>') + '<div class="px-memlist">' + (mems().map(UI.memRow).join('')
      || '<p class="px-empty">No project memories yet.</p>') + '</div></div>', function (el, close) {
      var f = el.querySelector('form');
      if (f) f.addEventListener('submit', function (e) {
        e.preventDefault(); var v = f.querySelector('input').value.trim(); if (!v) return;
        data.addMemory({ content: v, scope: 'project', project_id: p.id }).then(function () { close(); load()
          .then(function () { memorySheet(p); }); }).catch(fail);
      });
      el.querySelectorAll('[data-mdel]').forEach(function (b) { b.addEventListener('click', function () {
        data.deleteMemory(b.getAttribute('data-mdel')).then(function () { close(); load().then(function () {
          memorySheet(p); }); }).catch(fail); }); });
    }, { label: 'Project memory' });
  }
  load();
};
