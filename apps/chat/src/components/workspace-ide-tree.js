/* Colon AI · Workspace IDE: the Files panel (v0.31.0; was the Files tab). A real folder tree: tap a folder to open
   or close it, tap a file to open it in the editor. Header: New file, New folder, Upload, History, Download as ZIP
   (every file and folder, workspace-export.js). Each row's ⋯ menu: New file / New folder here (folders), Rename,
   Move, Delete. A folder rename or move moves everything in it as ONE version (POST /workspaces/:id/folder/move);
   deleting a folder removes all of it (one version too).
   Empty folders are kept as <folder>/.gitkeep (lib/ws-tree.js), so they exist in storage and in Git.
   mountTree(el, { id, data, files, active, onOpen(path), onChanged(), onMoved(from, to), onGone(prefix) })
     -> { update(files, active) } */
import { Colon } from '../../../../packages/ui/js/colon.js';
import * as UI from './project-ui.js';
import { KEEP, baseName, buildTree, join, parentOf } from '../lib/ws-tree.js';
import { downloadZip } from './workspace-export.js';

var C = Colon, icon = C.icon, esc = C.esc;
var TEXT = /\.(html?|css|m?js|json|txt|md|svg|xml|webmanifest|csv)$/i;
var STARTER = { html: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" '
  + 'content="width=device-width, initial-scale=1">\n  <title>New page</title>\n</head>\n<body>\n\n</body>\n'
  + '</html>\n' };
var open = {};   // workspace id -> { folder path: true } (kept while the app is open)

function readB64(file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
    r.onerror = function () { reject(new Error('That file couldn’t be read.')); };
    r.readAsDataURL(file);
  });
}
function ext(p) { return (String(p).split('.').pop() || '').slice(0, 4).toLowerCase(); }

function mountTree(el, o) {
  var data = o.data, id = o.id, files = o.files || [], active = o.active || '';
  var openSet = open[id] || (open[id] = {});
  function fail(e) { C.toast(e.message, 'bad'); }
  function paths() { return files.map(function (f) { return f.path; }); }
  function size(p) { var f = files.filter(function (x) { return x.path === p; })[0]; return f ? f.size : 0; }

  function rowFile(p, depth) {
    return '<div class="ide-row' + (p === active ? ' on' : '') + '" style="--d:' + depth + '"><button type="button" '
      + 'class="ide-item" data-open="' + esc(p) + '" title="' + esc(p) + '"><span class="ide-ext ide-x-' + esc(ext(p))
      + '">' + esc(ext(p)) + '</span><span class="ide-name">' + esc(baseName(p)) + '</span></button><button '
      + 'type="button" class="ide-more" data-more="' + esc(p) + '" aria-label="Options for ' + esc(p) + '">'
      + icon('moreV') + '</button></div>';
  }
  function rowDir(n, depth) {
    var on = Boolean(openSet[n.path]);
    var inner = on ? n.dirs.map(function (d) { return rowDir(d, depth + 1); }).join('')
      + n.files.map(function (p) { return rowFile(p, depth + 1); }).join('') : '';
    return '<div class="ide-row ide-dir" style="--d:' + depth + '"><button type="button" class="ide-item" '
      + 'data-dir="' + esc(n.path) + '" aria-expanded="' + on + '"><span class="ide-chev">' + icon(on ? 'chevDown'
      : 'chev') + '</span>' + icon('folder') + '<span class="ide-name">' + esc(n.name) + '</span></button><button '
      + 'type="button" class="ide-more" data-more-dir="' + esc(n.path) + '" aria-label="Options for folder '
      + esc(n.path) + '">' + icon('moreV') + '</button></div>' + inner;
  }
  function render() {
    var t = buildTree(paths());
    el.innerHTML = '<div class="ide-fhead"><b>Files</b><span><button type="button" class="ide-ib" data-act="file" '
      + 'aria-label="New file" title="New file">' + icon('file') + '</button><button type="button" class="ide-ib" '
      + 'data-act="folder" aria-label="New folder" title="New folder">' + icon('folder') + '</button><button '
      + 'type="button" class="ide-ib" data-act="up" aria-label="Upload" title="Upload">' + icon('upload')
      + '</button><button type="button" class="ide-ib" data-act="hist" aria-label="History" title="History">'
      + icon('history') + '</button><button type="button" class="ide-ib" data-act="zip" aria-label="Download as ZIP" '
      + 'title="Download as ZIP"' + (files.length ? '' : ' disabled') + '>' + icon('download')
      + '</button></span><input type="file" data-pick hidden multiple></div><div class="ide-tree" '
      + 'role="tree">' + (files.length ? t.dirs.map(function (d) { return rowDir(d, 0); }).join('')
        + t.files.map(function (p) { return rowFile(p, 0); }).join('') : '<p class="px-empty">No files yet.</p>')
      + '</div>';
    bind();
  }
  function reveal(p) { var f = parentOf(p); while (f) { openSet[f] = true; f = parentOf(f); } }

  function newFile(folder) {
    C.prompt({ title: 'New file', label: folder ? 'Name (in ' + folder + '/)' : 'Name, like about.html',
      max: 120 }).then(function (n) {
      if (!n || !n.trim()) return;
      var p = join(folder, n);
      if (paths().indexOf(p) > -1) { C.toast(p + ' already exists.', 'bad'); return; }
      var e = ext(p) === 'htm' ? 'html' : ext(p);
      data.putWorkspaceFile(id, { path: p, content: STARTER[e] || '', note: 'Added ' + p }).then(function () {
        reveal(p); o.onChanged(); if (TEXT.test(p)) o.onOpen(p);
      }).catch(fail);
    });
  }
  function newFolder(folder) {
    C.prompt({ title: 'New folder', label: folder ? 'Name (in ' + folder + '/)' : 'Folder name, like images',
      max: 64 }).then(function (n) {
      if (!n || !n.trim()) return;
      var f = join(folder, n);
      data.putWorkspaceFile(id, { path: f + '/' + KEEP, content: '', note: 'Added folder ' + f })
        .then(function () { openSet[f] = true; reveal(f); o.onChanged(); }).catch(fail);
    });
  }
  function rename(p, isDir) {
    C.prompt({ title: isDir ? 'Rename folder' : 'Rename', label: 'New name', value: baseName(p), max: 64 })
      .then(function (n) { if (n && n.trim() && n.trim() !== baseName(p)) move(p, join(parentOf(p), n), isDir); });
  }
  function moveTo(p, isDir) {
    C.prompt({ title: 'Move ' + baseName(p), label: 'New path (folder/name)', value: p, max: 200 })
      .then(function (to) { to = to && to.trim().replace(/^\/+|\/+$/g, ''); if (to && to !== p) move(p, to, isDir); });
  }
  function move(from, to, isDir) {
    var call = isDir ? data.moveWorkspaceFolder(id, from, to) : data.moveWorkspaceFile(id, from, to);
    call.then(function () { reveal(to); if (isDir) openSet[to] = true; o.onMoved(from, to, isDir); o.onChanged();
      C.toast('Moved to ' + to + '.', 'ok'); }).catch(fail);
  }
  function remove(p, isDir) {
    var n = isDir ? paths().filter(function (x) { return x.indexOf(p + '/') === 0 && baseName(x) !== KEEP; }).length
      : 0;
    C.confirm({ title: 'Delete ' + p + (isDir ? '/' : '') + '?', body: (isDir ? 'The folder and ' + UI.plural(n,
      'file') + ' in it are deleted. ' : '') + 'You can bring it back from History.', confirm: 'Delete',
    danger: true }).then(function (ok) {
      if (!ok) return;
      (isDir ? data.deleteWorkspaceFolder(id, p) : data.deleteWorkspaceFile(id, p)).then(function () {
        o.onGone(p, isDir); o.onChanged(); C.toast('Deleted ' + p + '.', 'ok'); }).catch(fail);
    });
  }
  function upload(list, folder) {
    var chain = Promise.resolve(), n = 0;
    [].slice.call(list || []).forEach(function (file) {
      chain = chain.then(function () {
        if (file.size > 1024 * 1024) throw new Error(file.name + ' is over 1 MB.');
        var p = join(folder, file.name.replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, ''));
        return (TEXT.test(p) ? file.text().then(function (t) { return { content: t, encoding: 'utf8' }; })
          : readB64(file).then(function (b) { return { content: b, encoding: 'base64' }; }))
          .then(function (c) { return data.putWorkspaceFile(id, { path: p, content: c.content, encoding: c.encoding,
            note: 'Uploaded ' + p }); }).then(function () { n++; });
      });
    });
    chain.then(function () { o.onChanged(); C.toast(n === 1 ? 'Uploaded.' : n + ' files uploaded.', 'ok'); },
      function (e) { if (n) o.onChanged(); fail(e); });
  }
  function history() {
    data.workspaceVersions(id).then(function (d) {
      C.sheet('<div class="px-sheet"><h2 class="h3">History</h2><div class="wk-versions">' + d.versions.map(
        function (v) {
          return '<div class="wk-ver"><span><b>' + esc(v.note) + '</b><small>Version ' + v.n + ' · '
            + esc(UI.rel(v.created_at)) + '</small></span>' + (v.n === d.current ? '<span class="px-badge">Current'
            + '</span>' : '<button type="button" class="btn sm" data-restore="' + v.n + '">Restore</button>')
            + '</div>';
        }).join('') + '</div><div class="sheet-actions"><button type="button" class="btn ghost" data-close>Close'
        + '</button></div></div>', function (s, close) {
        s.querySelectorAll('[data-restore]').forEach(function (b) { b.addEventListener('click', function () {
          var n = Number(b.getAttribute('data-restore'));
          data.restoreWorkspace(id, n).then(function () { close(); o.onChanged(); C.toast('Version ' + n
            + ' restored.', 'ok'); }).catch(fail);
        }); });
      }, { label: 'History' });
    }).catch(fail);
  }
  var upFolder = '';
  function bind() {
    var pick = el.querySelector('[data-pick]');
    pick.addEventListener('change', function () { upload(pick.files, upFolder); pick.value = ''; });
    el.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', function () {
      var a = b.getAttribute('data-act');
      if (a === 'file') newFile(''); else if (a === 'folder') newFolder('');
      else if (a === 'up') { upFolder = ''; pick.click(); } else if (a === 'zip') downloadZip(data, id, b);
      else history();
    }); });
    el.querySelectorAll('[data-dir]').forEach(function (b) { b.addEventListener('click', function () {
      var f = b.getAttribute('data-dir'); openSet[f] = !openSet[f]; render(); }); });
    el.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () {
      o.onOpen(b.getAttribute('data-open')); }); });
    el.querySelectorAll('[data-more]').forEach(function (b) { b.addEventListener('click', function () {
      var p = b.getAttribute('data-more');
      C.menu(b, [{ label: 'Rename', icon: 'edit', onClick: function () { rename(p, false); } },
        { label: 'Move', icon: 'folder', onClick: function () { moveTo(p, false); } }, '-',
        { label: 'Delete', icon: 'trash', danger: true, onClick: function () { remove(p, false); } }],
      { align: 'right', label: 'File options' });
    }); });
    el.querySelectorAll('[data-more-dir]').forEach(function (b) { b.addEventListener('click', function () {
      var f = b.getAttribute('data-more-dir');
      C.menu(b, [{ label: 'New file here', icon: 'file', onClick: function () { newFile(f); } },
        { label: 'New folder here', icon: 'folder', onClick: function () { newFolder(f); } },
        { label: 'Upload here', icon: 'upload', onClick: function () { upFolder = f;
          el.querySelector('[data-pick]').click(); } }, '-',
        { label: 'Rename', icon: 'edit', onClick: function () { rename(f, true); } },
        { label: 'Move', icon: 'folder', onClick: function () { moveTo(f, true); } }, '-',
        { label: 'Delete folder', icon: 'trash', danger: true, onClick: function () { remove(f, true); } }],
      { align: 'right', label: 'Folder options' });
    }); });
  }
  if (active) reveal(active);
  render();
  return { update: function (f, a) { files = f || files; if (a !== undefined) { active = a; if (a) reveal(a); }
    render(); } };
}

export { mountTree };
