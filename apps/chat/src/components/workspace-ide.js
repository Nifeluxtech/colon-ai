/* Colon AI · Workspace IDE tab (v0.31.0): Files, Code and Terminal in one screen, laid out like a desktop IDE.
     wide screens   Files tree | tabbed editor | Shell, side by side
     phones         a toolbar (Files, Save, Run, Shell), the tabbed editor filling the screen, the Files tree as a
                    drawer from the left and the Shell as a panel from the bottom (each toggles; both remembered)
   The pieces: workspace-ide-tree.js (folders), workspace-ide-editor.js (tabs, Monaco), workspace-term.js (shell).
   mount(el, { id, data, files, path?, onChanged(), onPath(path), onOpen(page) }) -> { ask(), dispose() } */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { mountTree } from './workspace-ide-tree.js';
import { mountEditor } from './workspace-ide-editor.js';
import { mount as mountTerm } from './workspace-term.js';

var C = Colon, icon = C.icon;
var KEY = 'colon.ide';
var TEXT = /\.(html?|css|m?js|json|txt|md|svg|xml|webmanifest|csv)$/i;

function prefs() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
function keep(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode */ } }

function mount(el, o) {
  var pf = prefs(), files = o.files || [];
  var wide = window.matchMedia && window.matchMedia('(min-width: 900px)').matches;
  var st = { tree: wide, shell: pf.shell !== undefined ? pf.shell : wide };
  el.innerHTML = '<div class="ide" data-ide><div class="ide-bar"><button type="button" class="ide-tb" data-t="tree" '
    + 'aria-label="Files" aria-pressed="false">' + icon('folder') + '<span>Files</span></button><span class="ide-path" '
    + 'data-path></span><button type="button" class="ide-tb" data-t="save" aria-label="Save" disabled>' + icon('check')
    + '<span>Save</span></button><button type="button" class="ide-tb ide-run" data-t="run" aria-label="Run in Preview">'
    + icon('play') + '<span>Run</span></button><button type="button" class="ide-tb" data-t="shell" aria-label="Shell" '
    + 'aria-pressed="false">' + icon('terminal') + '<span>Shell</span></button></div><div class="ide-body">'
    + '<aside class="ide-files" data-tree aria-label="Files"></aside><div class="ide-scrim" data-scrim></div>'
    + '<section class="ide-main" data-editor aria-label="Editor"></section><section class="ide-con" aria-label="Shell">'
    + '<div class="ide-con-head"><b>' + icon('terminal') + 'Shell</b><small>JavaScript and Python run on your device'
    + '</small><button type="button" class="ide-ib" data-t="shell" aria-label="Hide shell">' + icon('x') + '</button>'
    + '</div><div class="ide-con-body" data-term></div></section></div></div>';
  var root = el.querySelector('[data-ide]'), pathEl = el.querySelector('[data-path]');
  var saveBtn = el.querySelector('[data-t="save"]');
  var term = null, tree = null;

  function layout() {
    root.classList.toggle('tree-on', st.tree); root.classList.toggle('shell-on', st.shell);
    el.querySelectorAll('[data-t="tree"]').forEach(function (b) { b.setAttribute('aria-pressed', String(st.tree)); });
    el.querySelectorAll('.ide-bar [data-t="shell"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(st.shell)); });
    if (st.shell && !term) {
      term = mountTerm(el.querySelector('[data-term]'), { id: o.id, data: o.data, onChanged: refresh,
        onOpen: o.onOpen });
    }
  }
  function sync() {
    var a = editor.active();
    pathEl.textContent = a || 'No file open';
    saveBtn.disabled = !editor.isDirty();
  }
  function refresh() {
    return o.data.getWorkspace(o.id).then(function (d) { files = d.files || []; tree.update(files); if (o.onChanged) {
      o.onChanged(); } }).catch(function () {});
  }
  var editor = mountEditor(el.querySelector('[data-editor]'), { id: o.id, data: o.data,
    onSaved: function () { sync(); refresh(); },
    onActive: function (p) { if (o.onPath) o.onPath(p); if (tree) tree.update(null, p); sync(); } });
  tree = mountTree(el.querySelector('[data-tree]'), { id: o.id, data: o.data, files: files, active: o.path || '',
    onOpen: function (p) { editor.open(p); if (!wide) { st.tree = false; layout(); } },
    onChanged: refresh,
    onMoved: function (from, to, isDir) { editor.renamed(from, to, isDir); sync(); },
    onGone: function (p, isDir) { editor.gone(p, isDir); sync(); } });

  el.querySelectorAll('[data-t]').forEach(function (b) { b.addEventListener('click', function () {
    var t = b.getAttribute('data-t');
    if (t === 'tree') { st.tree = !st.tree; layout(); }
    else if (t === 'shell') { st.shell = !st.shell; pf.shell = st.shell; keep(pf); layout(); }
    else if (t === 'save') editor.save().then(sync);
    else if (t === 'run') {
      var a = editor.active();
      o.onOpen(/\.html?$/i.test(a) ? a : 'index.html');
    }
  }); });
  el.querySelector('[data-scrim]').addEventListener('click', function () { st.tree = false; layout(); });
  // the dirty dot and Save button follow typing (Monaco and the textarea both bubble input/keyup)
  el.querySelector('[data-editor]').addEventListener('keyup', sync);
  el.querySelector('[data-editor]').addEventListener('input', sync);

  var paths = files.map(function (f) { return f.path; }).filter(function (p) { return TEXT.test(p); });
  var first = o.path && paths.indexOf(o.path) > -1 ? o.path : paths.indexOf('index.html') > -1 ? 'index.html'
    : paths[0];
  if (first) editor.open(first);
  layout(); sync();
  return { dirty: editor.dirty, ask: editor.ask, open: function (p) { editor.open(p); },
    dispose: function () { editor.dispose(); if (term && term.dispose) term.dispose(); } };
}

export { mount };
