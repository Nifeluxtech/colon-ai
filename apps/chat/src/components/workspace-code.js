/* Colon AI · Workspace Code tab (v0.27.0, Workspace step 3; docs/workspace/step-3.md). Pick any text file and
   edit it in Monaco (the same editor Developer mode uses, loaded from jsDelivr on first use; a plain text box when
   it can't load). Save writes the file through PUT /workspaces/:id/file, which makes a new version (undo it from
   History). Switching files or tabs with unsaved changes asks first.
   mount(el, { id, data, files, path?, onSaved(path), onPath(path) }) -> { dirty(), dispose() } */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { loadMonaco } from './code-edit.js';
import { monacoLanguage } from '../lib/chat-tools.js';

var C = Colon, icon = C.icon, esc = C.esc;
var TEXT = /\.(html?|css|m?js|json|txt|md|svg|xml|webmanifest|csv)$/i;

function mount(el, o) {
  var list = (o.files || []).map(function (f) { return f.path; }).filter(function (p) { return TEXT.test(p); }).sort();
  var path = o.path && list.indexOf(o.path) > -1 ? o.path : list.indexOf('index.html') > -1 ? 'index.html' : list[0];
  var editor = null, ta = null, saved = '', model = null;
  if (!path) {
    el.innerHTML = '<p class="px-empty">No text files yet. Add one in Files, or ask Colon in Chat.</p>';
    return { dirty: function () { return false; }, dispose: function () {} };
  }
  el.innerHTML = '<div class="wk-code-ed"><div class="wk-pv-bar"><select class="input" data-file aria-label="File">'
    + list.map(function (p) { return '<option' + (p === path ? ' selected' : '') + '>' + esc(p) + '</option>'; })
      .join('') + '</select><button type="button" class="btn sm primary" data-save disabled>' + icon('check')
    + 'Save</button></div><div class="wk-editor" data-ed><div class="small muted wk-ed-msg">Loading…</div></div>'
    + '</div>';
  var sel = el.querySelector('[data-file]'), box = el.querySelector('[data-ed]'), btn = el.querySelector('[data-save]');

  function value() { return editor ? editor.getValue() : ta ? ta.value : saved; }
  function dirty() { return value() !== saved; }
  function sync() { btn.disabled = !dirty(); btn.innerHTML = icon('check') + (dirty() ? 'Save' : 'Saved'); }
  function fallback() {
    if (!el.isConnected || editor || ta) return;
    box.innerHTML = '<textarea class="textarea mono wk-ta" spellcheck="false" autocapitalize="off" '
      + 'aria-label="File contents"></textarea>';
    ta = box.querySelector('textarea'); ta.value = saved; ta.addEventListener('input', sync);
  }
  function show(text) {
    saved = text;
    if (ta) { ta.value = text; sync(); return; }
    var lang = monacoLanguage(path.split('.').pop());
    loadMonaco().then(function (m) {
      if (!el.isConnected) return;
      if (!editor) {
        box.innerHTML = '';
        editor = m.editor.create(box, { value: '', language: lang, automaticLayout: true, fontSize: 13,
          minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2,
          theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark' });
        editor.onDidChangeModelContent(sync);
        editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, save);
      }
      if (model) model.dispose();
      model = m.editor.createModel(text, lang);
      editor.setModel(model);
      sync();
    }, fallback);
  }
  function open(p) {
    path = p; if (o.onPath) o.onPath(p);
    box.querySelector('.wk-ed-msg') && (box.querySelector('.wk-ed-msg').textContent = 'Loading ' + p + '…');
    o.data.workspaceFile(o.id, p).then(function (f) { show(String(f.content)); })
      .catch(function (e) { C.toast(e.message, 'bad'); });
  }
  function save() {
    if (!dirty()) return;
    var text = value();
    btn.disabled = true;
    o.data.putWorkspaceFile(o.id, { path: path, content: text, note: 'Edited ' + path + ' (code editor)' })
      .then(function () { saved = text; sync(); C.toast('Saved ' + path + '.', 'ok'); if (o.onSaved) o.onSaved(path); })
      .catch(function (e) { sync(); C.toast(e.message, 'bad'); });
  }
  function ask() {
    if (!dirty()) return Promise.resolve(true);
    return C.confirm({ title: 'Discard your changes?', body: 'Your edits to ' + path + ' aren’t saved yet.',
      confirm: 'Discard', danger: true });
  }
  sel.addEventListener('change', function () {
    var next = sel.value;
    ask().then(function (ok) { if (ok) open(next); else sel.value = path; });
  });
  btn.addEventListener('click', save);
  open(path);
  return { dirty: dirty, ask: ask, dispose: function () { if (editor) editor.dispose(); if (model) model.dispose(); } };
}

export { mount };
