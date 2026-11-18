/* Colon AI · Projects (v0.15.0, Blueprint B10): the project list (create, rename, delete) and one project's page
   (instructions, its chats, a new chat in it, its files and its memories). How many projects a user may have
   comes from their plan; the server says so (402 quota) when BILLING_MODE is enforce. Signed-in only. */
import { Colon } from '../../../../packages/ui/js/colon.js';
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
    + '<div class="hist-list"><div class="skel" style="height:64px"></div></div></div>';
  page.querySelector('[data-new]').addEventListener('click', newProject);
  if (!data.listProjects) { page.querySelector('.hist-list').innerHTML = '<div class="card empty">' + icon('lock')
    + '<div class="h3">Log in to use projects</div></div>'; return; }
  function load() {
    data.listProjects().then(function (d) {
      var box = page.querySelector('.hist-list'), lim = d.limit || {};
      var note = lim.limit == null ? '' : '<p class="small muted">' + lim.used + ' of ' + lim.limit + ' projects on '
        + 'the ' + esc(lim.plan || 'current') + ' plan. <a href="#/account/plan">Plans</a></p>';
      box.innerHTML = note + (d.projects.length ? '<div class="list">' + d.projects.map(function (p) {
        return '<div class="hist-row"><a class="hist-main" href="#/p/' + encodeURIComponent(p.id)
          + '"><span class="hist-ico">' + icon('folder') + '</span><span class="hist-body"><b>' + esc(p.name)
          + '</b><small>' + p.chats + ' chat' + (p.chats === 1 ? '' : 's') + ' · ' + p.files + ' file'
          + (p.files === 1 ? '' : 's') + '</small></span><span class="hist-meta"><time>' + esc(C.ago(p.updated_at))
          + '</time></span></a><button class="icon-btn sm" data-pmenu="' + esc(p.id) + '" aria-label="Options for '
          + esc(p.name) + '" aria-haspopup="menu">' + icon('more') + '</button></div>';
      }).join('') + '</div>' : '<div class="card empty">' + icon('folder') + '<div class="h3">No projects yet</div>'
        + '<p class="small">Start one for a course, a trip or a piece of work.</p></div>');
      box.querySelectorAll('[data-pmenu]').forEach(function (b) {
        var p = d.projects.filter(function (x) { return x.id === b.getAttribute('data-pmenu'); })[0];
        b.addEventListener('click', function () {
          C.menu(b, [{ label: 'Rename', icon: 'edit', onClick: function () { renameProject(p, load); } }, '-',
            { label: 'Delete', icon: 'trash', danger: true, onClick: function () { deleteProject(p, load); } }],
          { align: 'right', label: 'Project options' });
        });
      });
    }).catch(function (e) { page.querySelector('.hist-list').innerHTML = '<div class="card empty">' + icon('alert')
      + '<div class="h3">Projects didn’t load</div><p class="small">' + esc(e.message) + '</p></div>'; });
  }
  load();
};

CW.pages.project = function (page, ctx) {
  var data = CW.data, id = ctx && ctx.projectId, st = {};
  page.innerHTML = screen('Project', '') + '<div class="skel" style="height:200px"></div></div>';
  function load() {
    Promise.all([data.getProject(id), data.getMemory({ projectId: id }).catch(function () { return null; })])
      .then(function (r) { st = r[0]; st.mem = r[1]; render(); })
      .catch(function (e) { page.innerHTML = screen('Project', '') + '<div class="card empty">' + icon('alert')
        + '<div class="h3">' + esc(e.message) + '</div><a class="btn" href="#/projects">All projects</a></div></div>';
      });
  }
  function render() {
    var p = st.project, memOn = st.mem && st.mem.memory.enabled;
    var mems = st.mem ? st.mem.memories.filter(function (m) { return m.scope === 'project'; }) : [];
    page.innerHTML = screen(p.name, p.chats + ' chats · ' + p.files + ' files',
      '<span class="set-inline"><button class="btn primary sm" type="button" data-pchat>' + icon('plus') + 'New chat'
      + '</button><button class="icon-btn sm" type="button" data-pmore aria-label="Project options">' + icon('more')
      + '</button></span>') +
      '<section class="set-sec"><h2 class="set-h">' + icon('edit') + 'Instructions</h2><form class="set-row stack" '
        + 'data-pinst novalidate><span class="sub">Colon follows these in every chat in this project.</span>'
        + '<textarea class="input" rows="4" maxlength="4000" data-pinst-t placeholder="e.g. I study nursing at UI. '
        + 'Explain simply and cite sources.">' + esc(p.instructions) + '</textarea><button class="btn sm" '
        + 'type="submit">Save instructions</button></form></section>' +
      '<section class="set-sec"><h2 class="set-h">' + icon('chat') + 'Chats</h2><div class="list">'
        + (st.chats.length ? st.chats.map(function (c) { return '<a class="row" href="#/c/' + encodeURIComponent(c.id)
          + '"><span class="ico">' + icon('chat') + '</span><span class="body"><span class="title">' + esc(c.title)
          + '</span><span class="sub">' + esc(c.preview || 'No messages yet') + ' · ' + esc(C.ago(c.updated_at))
          + '</span></span></a>'; }).join('') : '<p class="small muted">No chats yet. Start one, or move a chat '
          + 'here from its menu.</p>') + '</div></section>' +
      '<section class="set-sec"><h2 class="set-h">' + icon('file') + 'Files</h2><p class="small muted">Their text '
        + 'is shared with every chat in this project.</p><div class="list">' + st.files.map(function (f) {
          return '<div class="set-row"><span class="body"><span class="title">' + esc(f.name) + '</span><span '
            + 'class="sub">' + esc(C.fmtBytes(f.size)) + '</span></span><button class="icon-btn sm" type="button" '
            + 'data-fdel="' + esc(f.id) + '" aria-label="Delete file">' + icon('trash') + '</button></div>';
        }).join('') + '</div><label class="btn sm" style="margin-top:8px">' + icon('plus') + 'Add a file<input '
        + 'type="file" data-fup hidden></label></section>' +
      '<section class="set-sec"><h2 class="set-h">' + icon('bookmark') + 'Project memories</h2>' + (memOn
        ? '<form class="set-row" data-pmem novalidate><input class="input" maxlength="1000" placeholder="Something '
          + 'Colon should remember in this project"><button class="btn sm" type="submit">Add</button></form>'
        : '<p class="small muted">Memory is off. <a href="#/memory">Turn it on</a> to keep project memories.</p>')
        + '<div class="list">' + mems.map(function (m) { return '<div class="set-row"><span class="body"><span '
          + 'class="title">' + esc(m.content) + '</span></span><button class="icon-btn sm" type="button" data-mdel="'
          + esc(m.id) + '" aria-label="Delete memory">' + icon('trash') + '</button></div>'; }).join('')
        + '</div></section></div>';
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
