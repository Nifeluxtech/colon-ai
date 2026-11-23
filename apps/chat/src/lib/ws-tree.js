/* Colon AI · Workspace file tree (v0.31.0). Pure helpers for the IDE tab's Files panel: folders are real paths
   ("css/site.css" lives in the folder "css"); an empty folder is kept as "<folder>/.gitkeep", which the tree hides
   but Git pushes (so the folder exists in the repository too). DOM-free: unit-tested in
   packages/ui/test/ws-tree.test.js.
     buildTree(paths)            -> { name:'', path:'', dirs:[node], files:[path] }, folders first, both sorted
     folders(paths)              -> every folder path, sorted ("a", "a/b")
     movePlan(paths, from, to)   -> [{ from, to }] to rename or move a folder with everything in it
     under(paths, folder)        -> the paths inside a folder (any depth)
     parentOf(path), baseName(path), join(folder, name) */
var KEEP = '.gitkeep';

function baseName(p) { var s = String(p || ''); return s.slice(s.lastIndexOf('/') + 1); }
function parentOf(p) { var s = String(p || ''), i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); }
function join(folder, name) {
  var n = String(name || '').trim().replace(/^\/+|\/+$/g, '');
  return folder ? folder + '/' + n : n;
}
function isKeep(p) { return baseName(p) === KEEP; }

function folders(paths) {
  var seen = {};
  (paths || []).forEach(function (p) {
    var parts = String(p).split('/');
    for (var i = 1; i < parts.length; i++) seen[parts.slice(0, i).join('/')] = true;
  });
  return Object.keys(seen).sort();
}

function buildTree(paths) {
  var root = { name: '', path: '', dirs: [], files: [] }, byPath = { '': root };
  folders(paths).forEach(function (f) {
    var node = { name: baseName(f), path: f, dirs: [], files: [] };
    byPath[f] = node;
    byPath[parentOf(f)].dirs.push(node);
  });
  (paths || []).forEach(function (p) { if (!isKeep(p)) byPath[parentOf(p)].files.push(p); });
  (function sort(n) {
    n.dirs.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    n.files.sort(function (a, b) { return baseName(a).toLowerCase() < baseName(b).toLowerCase() ? -1 : 1; });
    n.dirs.forEach(sort);
  })(root);
  return root;
}

function under(paths, folder) {
  var pre = folder ? folder + '/' : '';
  return (paths || []).filter(function (p) { return !pre || String(p).indexOf(pre) === 0; });
}

function movePlan(paths, from, to) {
  var a = String(from || '').replace(/\/+$/, ''), b = String(to || '').replace(/^\/+|\/+$/g, '');
  if (!a || !b || a === b) return [];
  if ((b + '/').indexOf(a + '/') === 0) throw new Error('A folder can’t move inside itself.');
  return under(paths, a).map(function (p) { return { from: p, to: b + p.slice(a.length) }; });
}

export { KEEP, baseName, buildTree, folders, isKeep, join, movePlan, parentOf, under };
