/* Colon AI · Projects (v0.15.0, Blueprint B10): the project list (create, rename, delete) and one project's page
   (instructions, its chats, a new chat in it, its files and its memories). How many projects a user may have
   comes from their plan; the server says so (402 quota) when BILLING_MODE is enforce. Signed-in only. */
import { Colon } from '../../../../packages/ui/js/colon.js';
import * as UI from '../components/project-ui.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;
CW.pages = CW.pages || {};

function fail(e) {
  C.toast(e.message, 'bad', e.code === 'quota' ? { label: 'See plans', fn: function () { C.go('/account/plan'); } }
    : undefined);
}
function screen(title, lead, action) {
  return '<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">' + esc(title)
    + '</h1><p class="lead">' + esc(lead) + '</p></div>' + (action || '') + '</header>';
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
function renameProject(p, after) {
  C.prompt({ title: 'Rename project', label: 'Project name', value: p.name, max: 80 }).then(function (name) {
    if (name && name !== p.name) CW.data.updateProject(p.id, { name: name }).then(after).catch(fail);
  });
}
function deleteProject(p, after) {
  C.confirm({ title: 'Delete “' + p.name + '”?', body: 'Its chats and files stay and move back to your chat list. '
    + 'Its instructions and project memories are deleted.', confirm: 'Delete project', danger: true })
    .then(function (ok) { if (ok) CW.data.deleteProject(p.id).then(after).catch(fail); });
}

CW.pages.projects = function (page) {
  var data = CW.data;
  page.innerHTML = screen('Projects', 'Group chats, files and memories, with instructions for every chat in them.',
    '<button class="btn primary sm" type="button" data-new>' + icon('plus') + 'New project</button>')
    + '<div class="pj-list">' + UI.skeletonHtml(3) + '</div></div>';
  var scr = page.querySelector('.cw-screen'); scr.classList.add('pj-screen');
  // bound to this screen's own node: #cw-page is reused by every view, so listeners on it would pile up
  scr.addEventListener('click', function (e) { if (e.target.closest('[data-new]')) newProject(); });
  var box = page.querySelector('.pj-list');
  if (!data.listProjects) { box.innerHTML = '<div class="card empty">' + icon('lock')
    + '<div class="h3">Log in to use projects</div></div>'; return; }
  function load() {
    data.listProjects().then(function (d) {
      var h1 = page.querySelector('.cw-screen-head .h1');
      h1.innerHTML = 'Projects' + (d.projects.length ? '<span class="pj-count">' + d.projects.length + '</span>' : '');
      box.innerHTML = d.projects.length ? UI.usageHtml(d.limit) + '<div class="pj-grid">'
        + d.projects.map(UI.cardHtml).join('') + '</div>' : UI.emptyHtml();
      box.querySelectorAll('[data-pmenu]').forEach(function (b) {
        var p = d.projects.filter(function (x) { return x.id === b.getAttribute('data-pmenu'); })[0];
        b.addEventListener('click', function () {
          C.menu(b, [{ label: 'Rename', icon: 'edit', onClick: function () { renameProject(p, load); } }, '-',
            { label: 'Delete', icon: 'trash', danger: true, onClick: function () { deleteProject(p, load); } }],
          { align: 'right', label: 'Project options' });
        });
      });
    }).catch(function (e) { box.innerHTML = '<div class="card empty">' + icon('alert')
      + '<div class="h3">Projects didn’t load</div><p class="small">' + esc(e.message) + '</p></div>'; });
  }
  load();
};

CW.pages.project = function (page, ctx) {
  var data = CW.data, id = ctx && ctx.projectId, st = {};
  var back = '<a class="pj-back" href="#/projects">' + icon('left') + 'All projects</a>';
  page.innerHTML = '<div class="cw-screen pj-screen">' + back + '<div class="skel" style="height:96px"></div>'
    + '<div class="skel" style="height:220px;margin-top:16px"></div></div>';
  function load() {
    Promise.all([data.getProject(id), data.getMemory({ projectId: id }).catch(function () { return null; })])
      .then(function (r) { st = r[0]; st.mem = r[1]; render(); })
      .catch(function (e) { page.innerHTML = '<div class="cw-screen pj-screen">' + back + '<div class="card empty">'
        + icon('alert') + '<div class="h3">' + esc(e.message) + '</div><a class="btn" href="#/projects">All projects'
        + '</a></div></div>'; });
  }
  function render() {
    var p = st.project, memOn = st.mem && st.mem.memory.enabled;
    var mems = st.mem ? st.mem.memories.filter(function (m) { return m.scope === 'project'; }) : [];
    var newChat = '<button class="btn primary sm" type="button" data-pchat>' + icon('plus') + 'New chat</button>';
    page.innerHTML = '<div class="cw-screen pj-screen pj-detail" style="--pj:' + UI.hue(p.id) + '">' + back
      + '<header class="pj-hero"><span class="pj-ico lg">' + icon('folder') + '</span><div class="pj-hero-t"><h1 '
      + 'class="h1">' + esc(p.name) + '</h1><div class="pj-stats"><span>' + icon('chat') + UI.plural(p.chats, 'chat')
      + '</span><span>' + icon('file') + UI.plural(p.files, 'file') + '</span><span>' + icon('clock')
      + 'Updated ' + esc(C.ago(p.updated_at)) + '</span></div></div><span class="pj-hero-acts">' + newChat
      + '<button class="icon-btn sm boxed" type="button" data-pmore aria-label="Project options">' + icon('more')
      + '</button></span></header><div class="pj-cols"><div class="pj-col">' +
      UI.panel('edit', 'Instructions', { sub: 'Colon follows these in every chat in this project.' },
        '<form class="pj-inst" data-pinst novalidate><textarea class="textarea" rows="4" maxlength="4000" '
        + 'data-pinst-t aria-label="Project instructions" placeholder="e.g. I study nursing at UI. Explain simply '
        + 'and cite sources.">' + esc(p.instructions) + '</textarea><div class="pj-inst-f"><span class="tiny muted">'
        + 'Up to 4,000 characters</span><button class="btn sm" type="submit">Save instructions</button></div></form>')
      + UI.panel('chat', 'Chats', { count: st.chats.length }, st.chats.length ? '<div class="pj-rows">'
        + st.chats.map(UI.chatRow).join('') + '</div>' : UI.note('No chats yet. Start one, or move a chat here '
        + 'from its menu.')) + '</div><div class="pj-col">'
      + UI.panel('file', 'Files', { count: st.files.length, sub: 'Their text is shared with every chat here.',
        action: '<label class="btn sm pj-add">' + icon('upload') + 'Add<input type="file" data-fup hidden></label>' },
        st.files.length ? '<div class="pj-rows">' + st.files.map(UI.fileRow).join('') + '</div>'
          : UI.note('No files yet. Add notes, PDFs or code for every chat in this project to use.'))
      + UI.panel('bookmark', 'Project memories', { count: mems.length }, (memOn
        ? '<form class="pj-memadd" data-pmem novalidate><input class="input" maxlength="1000" aria-label="New '
          + 'project memory" placeholder="Something Colon should remember here"><button class="btn sm" '
          + 'type="submit">Add</button></form>'
        : UI.note('Memory is off. ', '<a class="link" href="#/memory">Turn it on</a> to keep project memories.'))
        + (mems.length ? '<div class="pj-rows">' + mems.map(UI.memRow).join('') + '</div>' : ''))
      + '</div></div></div>';
    bind(p);
  }
  function bind(p) {
    var $ = function (s) { return page.querySelector(s); };
    $('[data-pchat]').addEventListener('click', function () {
      data.createConversation({ mode: (CW.S.settings && CW.S.settings.defaultMode) || 'general', project_id: p.id })
        .then(function (c) { if (CW.refreshConvs) CW.refreshConvs(); C.go('/c/' + encodeURIComponent(c.id)); })
        .catch(fail);
    });
    $('[data-pmore]').addEventListener('click', function (e) {
      C.menu(e.currentTarget, [{ label: 'Rename', icon: 'edit', onClick: function () { renameProject(p, load); } },
        '-', { label: 'Delete', icon: 'trash', danger: true, onClick: function () { deleteProject(p, function () {
          C.go('/projects'); }); } }], { align: 'right', label: 'Project options' });
    });
    $('[data-pinst]').addEventListener('submit', function (e) {
      e.preventDefault();
      data.updateProject(p.id, { instructions: $('[data-pinst-t]').value }).then(function (n) {
        st.project = Object.assign(p, n); C.toast('Instructions saved.', 'ok'); }).catch(fail);
    });
    $('[data-fup]').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      C.toast('Uploading ' + f.name + '…');
      data.upload(f, { projectId: p.id }).then(function () { C.toast('File added.', 'ok'); load(); }).catch(fail);
    });
    page.querySelectorAll('[data-fdel]').forEach(function (b) { b.addEventListener('click', function () {
      data.removeUpload(b.getAttribute('data-fdel')).then(load).catch(fail); }); });
    var pm = $('[data-pmem]');
    if (pm) pm.addEventListener('submit', function (e) {
      e.preventDefault(); var v = pm.querySelector('input').value.trim(); if (!v) return;
      data.addMemory({ content: v, scope: 'project', project_id: p.id }).then(load).catch(fail);
    });
    page.querySelectorAll('[data-mdel]').forEach(function (b) { b.addEventListener('click', function () {
      data.deleteMemory(b.getAttribute('data-mdel')).then(load).catch(fail); }); });
  }
  load();
};
