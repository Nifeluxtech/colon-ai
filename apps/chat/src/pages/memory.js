/* Colon AI · Memory screen (v0.15.0, Blueprint B9): turn memory on or off, and view, add, edit and delete what
   Colon remembers. Memory is OFF until the user turns it on here; nothing is saved without them asking (a note
   added here, or "remember that …" in a chat; 0.24.0: and personal facts shared in a chat, source auto).
   Signed-in only (GET /memory, PUT /memory/consent, /memories). */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;
CW.pages = CW.pages || {};

var SCOPE_LABEL = { user: 'Every chat', project: 'Project', task: 'One chat' };

function head() {
  return '<header class="cw-screen-head"><div><h1 class="h1">Memory</h1><p class="lead">What Colon remembers about '
    + 'you, and when it uses it.</p></div><a class="btn sm" href="#/settings">' + icon('settings')
    + 'Settings</a></header>';
}

function itemHtml(m, names) {
  var where = m.scope === 'project' ? 'Project · ' + (names[m.project_id] || 'deleted') : SCOPE_LABEL[m.scope];
  return '<div class="set-row" data-mem="' + esc(m.id) + '"><span class="body"><span class="title">' + esc(m.content)
    + '</span><span class="sub">' + esc(where) + ' · ' + (m.source === 'auto' ? 'you told Colon'
    : m.source === 'chat' ? 'from a chat' : 'added here') + ' · '
    + esc(C.ago(m.updated_at)) + '</span></span>'
    + '<button class="icon-btn sm" type="button" data-mem-edit aria-label="Edit memory">' + icon('edit') + '</button>'
    + '<button class="icon-btn sm" type="button" data-mem-del aria-label="Delete memory">' + icon('trash')
    + '</button></div>';
}

CW.pages.memory = function (page) {
  var data = CW.data, state = { memory: null, list: [], names: {} };
  page.innerHTML = '<div class="cw-screen set-screen">' + head()
    + '<div class="skel" style="height:200px"></div></div>';
  if (!data.getMemory) { page.querySelector('.skel').outerHTML = '<div class="card empty">' + icon('lock')
    + '<div class="h3">Log in to use memory</div></div>'; return; }

  function load() {
    Promise.all([data.getMemory(), data.listProjects().catch(function () { return { projects: [] }; })])
      .then(function (r) {
        state.memory = r[0].memory; state.list = r[0].memories;
        state.names = {}; (r[1].projects || []).forEach(function (p) { state.names[p.id] = p.name; });
        render();
      }).catch(function (e) {
        page.innerHTML = '<div class="cw-screen set-screen">' + head() + '<div class="card empty">' + icon('alert')
          + '<div class="h3">Memory didn’t load</div><p class="small">' + esc(e.message) + '</p></div></div>';
      });
  }

  function render() {
    var m = state.memory, on = m.enabled;
    page.innerHTML = '<div class="cw-screen set-screen">' + head() +
      '<section class="set-sec"><div class="list">' +
        '<label class="set-row"><span class="body"><span class="title">Use memory</span><span class="sub">'
          + esc(m.notice) + '</span></span><span class="switch"><input type="checkbox" data-mem-on'
          + (on ? ' checked' : '') + ' aria-label="Use memory"><i></i></span></label>' +
        (on ? '' : '<div class="banner info">' + icon('info') + '<span>' + (m.chosen ? 'Memory is off. Colon '
          + 'doesn’t use or save memories. Your saved notes stay below until you delete them.' : 'Memory is off '
          + 'until you turn it on.') + '</span></div>') +
      '</div></section>' +
      '<section class="set-sec"><h2 class="set-h">' + icon('bookmark') + 'Saved memories <span class="badge">'
        + state.list.length + (m.max ? ' / ' + m.max : '') + '</span></h2>' +
        '<form class="set-row stack" data-mem-add novalidate><span class="body"><label class="title" for="mem-new">'
          + 'Add a memory</label><span class="sub">For example “I’m a nurse in Ibadan” or “Keep answers short”. '
          + 'In a chat, say “remember that …”, or just tell Colon about yourself (“Call me Elijah”).</span></span>'
          + '<span class="set-inline">'
          + '<input class="input" id="mem-new" maxlength="1000"' + (on ? '' : ' disabled')
          + ' placeholder="Something Colon should remember"><button class="btn sm" type="submit"'
          + (on ? '' : ' disabled') + '>Add</button></span></form>' +
        '<div class="list" data-mem-list>' + (state.list.length ? state.list.map(function (x) {
          return itemHtml(x, state.names); }).join('') : '<div class="card empty">' + icon('bookmark')
          + '<div class="h3">No memories yet</div></div>') + '</div>' +
        (state.list.length ? '<button class="btn sm danger mem-clear" type="button" data-mem-clear>'
          + icon('trash') + 'Delete all memories</button>' : '') +
      '</section></div>';
    bind();
  }

  function fail(e) { C.toast(e.message, 'bad'); }
  function bind() {
    page.querySelector('[data-mem-on]').addEventListener('change', function (e) {
      var on = e.target.checked;
      data.setMemoryConsent(on).then(function (d) { state.memory = d.memory; render();
        C.toast(on ? 'Memory is on.' : 'Memory is off.', 'ok'); }).catch(function (err) { e.target.checked = !on;
        fail(err); });
    });
    page.querySelector('[data-mem-add]').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = page.querySelector('#mem-new'), v = inp.value.trim(); if (!v) return;
      data.addMemory({ content: v }).then(function (x) { state.list.unshift(x); render(); C.toast('Saved.', 'ok'); })
        .catch(fail);
    });
    page.querySelectorAll('[data-mem]').forEach(function (row) {
      var id = row.getAttribute('data-mem');
      var item = state.list.filter(function (x) { return x.id === id; })[0];
      row.querySelector('[data-mem-edit]').addEventListener('click', function () {
        C.prompt({ title: 'Edit memory', label: 'Memory', value: item.content, max: 1000 }).then(function (v) {
          if (!v || v === item.content) return;
          data.editMemory(id, v).then(function (x) { Object.assign(item, x); render(); C.toast('Saved.', 'ok'); })
            .catch(fail);
        });
      });
      row.querySelector('[data-mem-del]').addEventListener('click', function () {
        data.deleteMemory(id).then(function () { state.list = state.list.filter(function (x) { return x !== item; });
          render(); C.toast('Deleted.'); }).catch(fail);
      });
    });
    var clear = page.querySelector('[data-mem-clear]');
    if (clear) clear.addEventListener('click', function () {
      C.confirm({ title: 'Delete all memories?', body: 'Colon forgets everything saved here. This can’t be undone.',
        confirm: 'Delete all', danger: true }).then(function (ok) {
        if (ok) data.clearMemory().then(function () { state.list = []; render(); C.toast('All memories deleted.'); })
          .catch(fail);
      });
    });
  }
  load();
};
