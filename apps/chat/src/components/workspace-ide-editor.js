/* Colon AI · Workspace IDE: the tabbed code editor (v0.31.0; was the Code tab). Several files open at once, one
   tab each (a dot marks unsaved changes); Monaco (loaded from jsDelivr on first use, one model per tab) or a plain
   text box when it can't load. Save (or Ctrl/Cmd+S) writes the active file through PUT /workspaces/:id/file, which
   makes a new version. Images open as a picture. Closing a tab with unsaved changes asks first.
   mountEditor(el, { id, data, onSaved(path), onActive(path) })
     -> { open(path), close(path), renamed(from, to, isDir), gone(path, isDir), dirty(), ask(), save(), dispose() } */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { loadMonaco } from './code-edit.js';
import { monacoLanguage } from '../lib/chat-tools.js';
import { baseName } from '../lib/ws-tree.js';

var C = Colon, icon = C.icon, esc = C.esc;
var TEXT = /\.(html?|css|m?js|json|txt|md|svg|xml|webmanifest|csv)$/i;

function mountEditor(el, o) {
  var tabs = [], cur = null, editor = null, monaco = null, ta = null, failed = false;
  el.innerHTML = '<div class="ide-tabs" role="tablist" data-tabs></div><div class="ide-ed" data-ed><p class="px-empty">'
    + 'Open a file from Files.</p></div>';
  var bar = el.querySelector('[data-tabs]'), box = el.querySelector('[data-ed]');
  function find(p) { return tabs.filter(function (t) { return t.path === p; })[0] || null; }
  function value(t) { return t.model ? t.model.getValue() : t.text; }
  function isDirty(t) { return t.text !== undefined && !t.image && value(t) !== t.saved; }
  function drawTabs() {
    bar.innerHTML = tabs.map(function (t) {
      return '<div class="ide-tab' + (t === cur ? ' on' : '') + '" role="tab" aria-selected="' + (t === cur)
        + '"><button type="button" data-tab="' + esc(t.path) + '" title="' + esc(t.path) + '">' + esc(baseName(t.path))
        + (isDirty(t) ? '<i class="ide-dot" aria-label="unsaved"></i>' : '') + '</button><button type="button" '
        + 'class="ide-x" data-close="' + esc(t.path) + '" aria-label="Close ' + esc(t.path) + '">' + icon('x')
        + '</button></div>';
    }).join('');
    bar.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () {
      show(find(b.getAttribute('data-tab'))); }); });
    bar.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () {
      close(b.getAttribute('data-close')); }); });
    var on = bar.querySelector('.ide-tab.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function changed() { drawTabs(); }
  function plain(t) {
    if (editor) { editor.getDomNode().style.display = 'none'; }
    if (!ta) {
      ta = document.createElement('textarea');
      ta.className = 'textarea mono wk-ta'; ta.spellcheck = false; ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('aria-label', 'File contents');
      ta.addEventListener('input', function () { if (cur && !cur.model) cur.text = ta.value; changed(); });
    }
    box.innerHTML = ''; box.appendChild(ta); ta.value = t.text;
  }
  function show(t) {
    if (!t) return;
    cur = t; if (o.onActive) o.onActive(t.path);
    drawTabs();
    if (t.image) { box.innerHTML = '<div class="ide-img"><img alt="' + esc(t.path) + '" src="' + t.image + '"></div>';
      return; }
    if (t.text === undefined) { box.innerHTML = '<p class="small muted wk-ed-msg">Loading ' + esc(t.path) + '…</p>';
      return; }
    if (failed || !monaco) { plain(t); return; }
    if (!editor || !box.contains(editor.getDomNode())) {
      box.innerHTML = ''; if (editor) editor.dispose();
      editor = monaco.editor.create(box, { value: '', automaticLayout: true, fontSize: 13, minimap: { enabled: false },
        scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, lineNumbersMinChars: 3, folding: false,
        theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark' });
      editor.onDidChangeModelContent(changed);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    }
    if (!t.model) t.model = monaco.editor.createModel(t.text, monacoLanguage(t.path.split('.').pop()));
    editor.setModel(t.model);
  }
  function load(t) {
    o.data.workspaceFile(o.id, t.path).then(function (f) {
      if (f.encoding === 'base64' && /^image\//.test(f.type)) t.image = 'data:' + f.type + ';base64,' + f.content;
      else if (!TEXT.test(t.path)) t.image = '';
      t.text = t.saved = t.image === undefined ? String(f.content) : '';
      if (cur !== t) return;
      if (t.image !== undefined || failed || monaco) { show(t); return; }
      loadMonaco().then(function (m) { monaco = m; }, function () { failed = true; })
        .then(function () { if (el.isConnected && cur === t) show(t); });
    }).catch(function (e) { C.toast(e.message, 'bad'); close(t.path, true); });
  }
  function open(p) {
    var t = find(p);
    if (!t) { t = { path: p, saved: '' }; tabs.push(t); load(t); }
    show(t);
  }
  function drop(t) {
    if (t.model) t.model.dispose();
    var i = tabs.indexOf(t); tabs.splice(i, 1);
    if (cur === t) { cur = null; if (tabs.length) show(tabs[Math.max(0, i - 1)]); else { box.innerHTML = '<p '
      + 'class="px-empty">Open a file from Files.</p>'; editor = null; if (o.onActive) o.onActive(''); } }
    drawTabs();
  }
  function close(p, force) {
    var t = find(p);
    if (!t) return Promise.resolve(true);
    if (force || !isDirty(t)) { drop(t); return Promise.resolve(true); }
    return C.confirm({ title: 'Close ' + baseName(p) + '?', body: 'Your changes aren’t saved yet.',
      confirm: 'Discard', danger: true }).then(function (ok) { if (ok) drop(t); return ok; });
  }
  function save() {
    var t = cur;
    if (!t || !isDirty(t)) return Promise.resolve();
    var text = value(t);
    return o.data.putWorkspaceFile(o.id, { path: t.path, content: text, note: 'Edited ' + t.path })
      .then(function () { t.saved = text; t.text = text; drawTabs(); C.toast('Saved ' + t.path + '.', 'ok');
        if (o.onSaved) o.onSaved(t.path); })
      .catch(function (e) { C.toast(e.message, 'bad'); });
  }
  function renamed(from, to, isDir) {
    tabs.forEach(function (t) {
      if (t.path === from) t.path = to;
      else if (isDir && t.path.indexOf(from + '/') === 0) t.path = to + t.path.slice(from.length);
    });
    drawTabs();
  }
  function gone(p, isDir) {
    tabs.slice().forEach(function (t) { if (t.path === p || isDir && t.path.indexOf(p + '/') === 0) drop(t); });
  }
  function dirty() { return tabs.some(isDirty); }
  function ask() {
    if (!dirty()) return Promise.resolve(true);
    return C.confirm({ title: 'Discard your changes?', body: 'Some open files aren’t saved yet.', confirm: 'Discard',
      danger: true });
  }
  return { open: open, close: close, renamed: renamed, gone: gone, dirty: dirty, ask: ask, save: save,
    active: function () { return cur ? cur.path : ''; }, isDirty: function () { return Boolean(cur && isDirty(cur)); },
    dispose: function () { tabs.forEach(function (t) { if (t.model) t.model.dispose(); }); if (editor) editor.dispose();
    } };
}

export { mountEditor };
