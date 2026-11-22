/* Colon AI · Workspace Files tab (v0.25.0 list + history; v0.27.0 step 3 adds editing). Every file with its size;
   tap a text file to edit it in Code, an image to view it. Per-file menu: Edit, Rename/move, Delete. New file and
   Upload (images, fonts, or any allowed file up to 1 MB). Below: version History with Restore. Each change is a
   version, so nothing here is final.
   mount(el, { id, data, files, onEdit(path), onChanged() }) */
import { Colon } from '../../../../packages/ui/js/colon.js';
import * as UI from './project-ui.js';

var C = Colon, icon = C.icon, esc = C.esc;
var TEXT = /\.(html?|css|m?js|json|txt|md|svg|xml|webmanifest|csv)$/i;
var STARTER = { html: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" '
  + 'content="width=device-width, initial-scale=1">\n  <title>New page</title>\n</head>\n<body>\n\n</body>\n'
  + '</html>\n' };

function rowHtml(f) {
  var ext = (String(f.path).split('.').pop() || '').slice(0, 4).toUpperCase();
  return '<div class="px-file wk-file"><button type="button" class="wk-file-open" data-open="' + esc(f.path) + '">'
    + '<span class="px-file-ico">' + esc(ext) + '</span><span class="px-file-b"><b>' + esc(f.path) + '</b><small>'
    + esc(C.fmtBytes(f.size)) + '</small></span></button><button type="button" class="icon-btn" data-fmore="'
    + esc(f.path) + '" aria-label="Options for ' + esc(f.path) + '">' + icon('more') + '</button></div>';
}

function readB64(file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
    r.onerror = function () { reject(new Error('That file couldn’t be read.')); };
    r.readAsDataURL(file);
  });
}

function mount(el, o) {
  var data = o.data, id = o.id;
  function fail(e) { C.toast(e.message, 'bad'); }
  function done(msg) { C.toast(msg, 'ok'); o.onChanged(); }
  el.innerHTML = '<div class="wk-fbar"><button type="button" class="btn sm" data-new>' + icon('plus') + 'New file'
    + '</button><button type="button" class="btn sm" data-up>' + icon('upload') + 'Upload</button><input type="file" '
    + 'data-file hidden multiple accept="image/*,.woff,.woff2,.ttf,.otf,.html,.css,.js,.json,.txt,.md,.svg,.csv">'
    + '</div><h2 class="px-h">Files</h2><div class="wk-files">' + (o.files.length ? o.files.map(rowHtml).join('')
      : '<p class="px-empty">No files yet.</p>') + '</div><h2 class="px-h">History</h2><div class="wk-versions" '
    + 'data-versions><div class="skel px-skel-c"></div></div>';
  var picker = el.querySelector('[data-file]');

  function open(p) {
    if (TEXT.test(p) && !/\.svg$/i.test(p)) { o.onEdit(p); return; }
    data.workspaceFile(id, p).then(function (f) {
      var body = f.encoding === 'base64' && /^image\//.test(f.type) || /\.svg$/i.test(p) ? '<img class="wk-img" alt="'
        + esc(f.path) + '" src="data:' + esc(f.type) + ';base64,' + (f.encoding === 'base64' ? f.content
        : btoa(unescape(encodeURIComponent(f.content)))) + '">' : '<p class="px-empty">' + esc(C.fmtBytes(f.size))
        + ' font file.</p>';
      C.sheet('<div class="px-sheet"><h2 class="h3">' + esc(f.path) + '</h2>' + body + '<div class="sheet-actions">'
        + (/\.svg$/i.test(p) ? '<button type="button" class="btn" data-ed>' + icon('code') + 'Edit</button>' : '')
        + '<button type="button" class="btn ghost" data-close>Close</button></div></div>', function (s, close) {
        var b = s.querySelector('[data-ed]');
        if (b) b.addEventListener('click', function () { close(); o.onEdit(p); });
      }, { label: f.path });
    }).catch(fail);
  }
  function rename(p) {
    C.prompt({ title: 'Rename or move', label: 'New path', value: p, max: 200 }).then(function (to) {
      to = to && to.trim();
      if (to && to !== p) data.moveWorkspaceFile(id, p, to).then(function () { done('Moved to ' + to + '.'); })
        .catch(fail);
    });
  }
  function remove(p) {
    C.confirm({ title: 'Delete ' + p + '?', body: 'You can bring it back from History.', confirm: 'Delete',
      danger: true }).then(function (ok) {
      if (ok) data.deleteWorkspaceFile(id, p).then(function () { done('Deleted ' + p + '.'); }).catch(fail);
    });
  }
  function create() {
    C.prompt({ title: 'New file', label: 'Path, like about.html or css/extra.css', value: '', max: 200 })
      .then(function (p) {
        p = p && p.trim().replace(/^\/+/, '');
        if (!p) return;
        if (o.files.some(function (f) { return f.path === p; })) { C.toast(p + ' already exists.', 'bad'); return; }
        var ext = p.split('.').pop().toLowerCase();
        data.putWorkspaceFile(id, { path: p, content: STARTER[ext === 'htm' ? 'html' : ext] || '', note: 'Added ' + p })
          .then(function () { o.onChanged(); if (TEXT.test(p)) o.onEdit(p); }).catch(fail);
      });
  }
  function upload(list) {
    var arr = [].slice.call(list || []);
    if (!arr.length) return;
    var chain = Promise.resolve(), n = 0;
    arr.forEach(function (file) {
      chain = chain.then(function () {
        if (file.size > 1024 * 1024) throw new Error(file.name + ' is over 1 MB.');
        var name = file.name.replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '');
        var dir = /^image\//.test(file.type) ? 'images/' : /\.(woff2?|ttf|otf)$/i.test(name) ? 'fonts/' : '';
        return (TEXT.test(name) ? file.text().then(function (t) { return { content: t, encoding: 'utf8' }; })
          : readB64(file).then(function (b) { return { content: b, encoding: 'base64' }; }))
          .then(function (c) {
            return data.putWorkspaceFile(id, { path: dir + name, content: c.content, encoding: c.encoding,
              note: 'Uploaded ' + dir + name });
          }).then(function () { n++; });
      });
    });
    chain.then(function () { done(n === 1 ? 'Uploaded.' : n + ' files uploaded.'); },
      function (e) { if (n) o.onChanged(); fail(e); });
  }
  function versions() {
    data.workspaceVersions(id).then(function (d) {
      var box = el.querySelector('[data-versions]');
      if (!box) return;
      box.innerHTML = d.versions.map(function (v) {
        return '<div class="wk-ver"><span><b>' + esc(v.note) + '</b><small>Version ' + v.n + ' · ' + esc(UI.rel(
          v.created_at)) + '</small></span>' + (v.n === d.current ? '<span class="px-badge">Current</span>'
          : '<button type="button" class="btn sm" data-restore="' + v.n + '">Restore</button>') + '</div>';
      }).join('') || '<p class="px-empty">No history yet.</p>';
      box.querySelectorAll('[data-restore]').forEach(function (b) { b.addEventListener('click', function () {
        var n = Number(b.getAttribute('data-restore'));
        C.confirm({ title: 'Restore version ' + n + '?', body: 'Your files go back to how they were then. This is '
          + 'saved as a new version, so you can undo it.', confirm: 'Restore' }).then(function (ok) {
          if (ok) data.restoreWorkspace(id, n).then(function () { done('Version ' + n + ' restored.'); }).catch(fail);
        });
      }); });
    }).catch(fail);
  }
  el.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () {
    open(b.getAttribute('data-open')); }); });
  el.querySelectorAll('[data-fmore]').forEach(function (b) { b.addEventListener('click', function () {
    var p = b.getAttribute('data-fmore');
    C.menu(b, [{ label: TEXT.test(p) ? 'Edit' : 'View', icon: TEXT.test(p) ? 'code' : 'eye', onClick: function () {
      if (TEXT.test(p)) o.onEdit(p); else open(p); } }, { label: 'Rename or move', icon: 'edit',
      onClick: function () { rename(p); } }, '-', { label: 'Delete', icon: 'trash', danger: true,
      onClick: function () { remove(p); } }], { align: 'right', label: 'File options' });
  }); });
  el.querySelector('[data-new]').addEventListener('click', create);
  el.querySelector('[data-up]').addEventListener('click', function () { picker.click(); });
  picker.addEventListener('change', function () { upload(picker.files); picker.value = ''; });
  versions();
}

export { mount };
