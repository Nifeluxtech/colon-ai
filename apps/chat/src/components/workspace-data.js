/* Colon AI · Workspace Data tab (v0.29.0, Workspace step 5; plan: docs/workspace/plan.md). The site's database
   (tables of JSON records, with who can read and add) and its secret keys (names only; values never come back).
   Records open in a sheet, newest first, with Delete. The forms live in workspace-data-forms.js; v0.30.0 adds
   sign-in services (workspace-connect.js) at the top; v0.31.0 Git repositories
   (workspace-git.js) and server databases Colon can change (workspace-remote.js).
   mount(el, o) where o = { id, data }. */
import { Colon } from '../../../../packages/ui/js/colon.js';
import * as UI from './project-ui.js';
import { secretSheet, tableSheet } from './workspace-data-forms.js';
import { connectionsHtml, pickProvider, connectionMenu } from './workspace-connect.js';
import { gitHtml, bindGit } from './workspace-git.js';
import { remoteHtml, bindRemote } from './workspace-remote.js';

var C = Colon, icon = C.icon, esc = C.esc;

function asLabel(as) {
  return as === 'bearer' ? 'Bearer token' : /^header:/.test(as) ? 'Header ' + as.slice(7) : 'Parameter '
    + String(as).slice(6);
}
function rules(t) {
  return (t.read === 'public' ? 'Visitors read' : 'Private') + ' · ' + (t.add === 'public' ? 'visitors add'
    : 'only you add');
}
function preview(v) {
  var s;
  try { s = JSON.stringify(v); } catch (e) { s = String(v); }
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
}

function records(o, t, done) {
  C.sheet('<div class="px-sheet wk-recs"><h2 class="h3">' + esc(t.name) + '</h2><p class="small muted">' + esc(rules(t))
    + '</p><div class="wk-rec-list" data-list><div class="skel px-skel-c"></div></div><div class="sheet-actions">'
    + '<button type="button" class="btn ghost" data-more hidden>Load more</button><button type="button" class="btn" '
    + 'data-close>Close</button></div></div>', function (el) {
    var list = el.querySelector('[data-list]'), more = el.querySelector('[data-more]'), next = null, rows = [];
    function draw() {
      list.innerHTML = rows.length ? rows.map(function (r) {
        return '<div class="wk-rec"><code>' + esc(preview(r.data)) + '</code><small>#' + r.id + ' · '
          + esc(new Date(r.created_at).toLocaleString()) + '</small><button type="button" class="icon-btn" '
          + 'data-del="' + r.id + '" aria-label="Delete record ' + r.id + '">' + icon('trash') + '</button></div>';
      }).join('') : '<p class="px-empty">No records yet.</p>';
      more.hidden = !next;
      list.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () {
        var rid = Number(b.getAttribute('data-del'));
        o.data.deleteWorkspaceRecord(o.id, t.name, rid).then(function () {
          rows = rows.filter(function (r) { return r.id !== rid; }); draw(); done();
        }).catch(function (e) { C.toast(e.message, 'bad'); });
      }); });
    }
    function page() {
      o.data.workspaceRecords(o.id, t.name, next).then(function (d) {
        rows = rows.concat(d.records || []); next = d.next; draw();
      }).catch(function (e) { list.innerHTML = '<p class="px-empty">' + esc(e.message) + '</p>'; });
    }
    more.addEventListener('click', page);
    page();
  }, { label: 'Records in ' + t.name });
}

function bad(e) { C.toast(e.message, 'bad'); }

function mount(el, o) {
  var st = null;
  var fo = { id: o.id, data: o.data, onSaved: function () { load(); } };
  el.innerHTML = '<div class="wk-data"><div class="skel px-skel-c"></div></div>';
  var box = el.firstChild;
  function load() {
    return o.data.workspaceData(o.id).then(function (d) { st = d; if (el.isConnected) render(); })
      .catch(function (e) { box.innerHTML = '<p class="px-empty">Data didn’t load. ' + esc(e.message) + '</p>'; });
  }
  function render() {
    var script = '<script src="' + st.api + '/sites/' + st.key + '/colon.js"></script>';
    box.innerHTML = connectionsHtml(st) + gitHtml(st) + remoteHtml(st) + '<section class="wk-dsec"><div '
      + 'class="wk-dhead"><h3>' + icon('database')
      + 'Colon database</h3>'
      + '<button type="button" class="btn sm" data-newt>' + icon('plus') + 'Table</button></div>'
      + (st.collections.length ? st.collections.map(function (t, i) {
        return '<div class="wk-row"><button type="button" class="px-row" data-open="' + i + '"><b>' + esc(t.name)
          + '</b><small>' + esc(UI.plural(t.records, 'record')) + ' · '
          + esc(rules(t)) + '</small></button><button class="icon-btn" type="button" data-tmore="' + i
          + '" aria-label="Options for ' + esc(t.name) + '">' + icon('more') + '</button></div>';
      }).join('') : '<p class="px-empty">No tables yet. Ask Colon for a contact form, orders or a guestbook and it '
        + 'will set one up, or add one here.</p>') + '</section>'
      + '<section class="wk-dsec"><div class="wk-dhead"><h3>' + icon('key') + 'Secret keys</h3>'
      + '<button type="button" class="btn sm" data-news>' + icon('plus') + 'Key</button></div>'
      + (st.secrets.length ? st.secrets.map(function (s, i) {
        return '<div class="wk-row"><div class="px-row"><b>' + esc(s.name) + '</b><small>' + (s.host ? esc(s.host)
          + ' · ' + esc(asLabel(s.as)) : 'No API host yet') + '</small></div><button class="icon-btn" type="button" '
          + 'data-smore="' + i + '" aria-label="Options for ' + esc(s.name) + '">' + icon('more') + '</button></div>';
      }).join('') : '<p class="px-empty">No keys yet. API keys live here, never in your files.</p>') + '</section>'
      + '<section class="wk-dsec wk-duse"><h3>' + icon('code') + 'Use in your site</h3><p class="small muted">Colon '
      + 'adds this for you when a build needs it.</p><code>' + esc(script) + '</code><button type="button" '
      + 'class="btn sm" data-copy>' + icon('copy') + 'Copy</button></section>';
    bindGit(box, fo, st); bindRemote(box, fo, st);   // v0.31.0
    box.querySelector('[data-newt]').addEventListener('click', function () { tableSheet(fo); });
    box.querySelector('[data-conn-add]').addEventListener('click', function (e) {   // v0.30.0
      pickProvider(e.currentTarget, fo, st); });
    box.querySelectorAll('[data-conn]').forEach(function (b) { b.addEventListener('click', function () {
      connectionMenu(b, fo, st, b.getAttribute('data-conn')); }); });
    box.querySelector('[data-news]').addEventListener('click', function () { secretSheet(fo); });
    box.querySelector('[data-copy]').addEventListener('click', function () {
      C.copyText(script).then(function () { C.toast('Copied.', 'ok'); }); });
    box.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () {
      records(o, st.collections[Number(b.getAttribute('data-open'))], load); }); });
    box.querySelectorAll('[data-tmore]').forEach(function (b) { b.addEventListener('click', function () {
      var t = st.collections[Number(b.getAttribute('data-tmore'))];
      C.menu(b, [{ label: 'Who can use it', icon: 'users', onClick: function () {
        tableSheet(fo, { name: t.name, read: t.read, add: t.add, edit: true }); } }, '-',
      { label: 'Delete table', icon: 'trash', danger: true, onClick: function () {
        C.confirm({ title: 'Delete “' + t.name + '”?', body: 'Its ' + t.records + ' records are deleted for good.',
          confirm: 'Delete table', danger: true }).then(function (ok) {
          if (ok) o.data.deleteWorkspaceTable(o.id, t.name).then(load).catch(bad);
        }); } }], { align: 'right', label: 'Table options' });
    }); });
    box.querySelectorAll('[data-smore]').forEach(function (b) { b.addEventListener('click', function () {
      var s = st.secrets[Number(b.getAttribute('data-smore'))];
      C.menu(b, [{ label: 'Replace or edit', icon: 'edit', onClick: function () {
        secretSheet(fo, { name: s.name, host: s.host, as: s.as, edit: true }); } }, '-',
      { label: 'Delete key', icon: 'trash', danger: true, onClick: function () {
        C.confirm({ title: 'Delete ' + s.name + '?', body: 'Parts of your site that use it stop working.',
          confirm: 'Delete key', danger: true }).then(function (ok) {
          if (ok) o.data.deleteWorkspaceSecret(o.id, s.name).then(load).catch(bad);
        }); } }], { align: 'right', label: 'Key options' });
    }); });
  }
  load();
  return { refresh: load };
}

export { mount };
