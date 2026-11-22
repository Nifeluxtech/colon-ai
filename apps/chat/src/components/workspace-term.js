/* Colon AI · Workspace Terminal tab (v0.27.0, Workspace step 3; docs/workspace/step-3.md). A phone-friendly
   terminal: output above, one input line below that works with the Android keyboard (a plain <input>, which is
   more reliable on phones than a canvas terminal), ↑/↓ history buttons, Stop, and quick keys for Tab-less typing.
   Commands come from lib/ws-shell.js; JavaScript and Python run on the phone in lib/ws-runner.js. Nothing runs on
   the server. The session (output, folder, history) lasts while the workspace is open.
   mount(el, { id, data, onChanged(), onOpen(path) }) -> { dispose() } */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { createShell } from '../lib/ws-shell.js';
import { createRunner } from '../lib/ws-runner.js';

var C = Colon, icon = C.icon;
var MAX_LINES = 1500;
var sessions = {};   // workspace id -> { shell, runner, log[], inputs[] } kept while the app is open

function session(o) {
  var s = sessions[o.id];
  if (s) return s;
  s = sessions[o.id] = { log: [], inputs: [], runner: null, view: null };
  function print(kind, text) {
    String(text).split('\n').forEach(function (l) { s.log.push([kind, l]); });
    if (s.log.length > MAX_LINES) s.log.splice(0, s.log.length - MAX_LINES);
    if (s.view) s.view(kind, text);
  }
  function wrote() { o.onChanged(); }
  var fs = {
    list: function () { return o.data.getWorkspace(o.id).then(function (d) { return d.files || []; }); },
    read: function (p) { return o.data.workspaceFile(o.id, p); },
    write: function (p, text, note) { return o.data.putWorkspaceFile(o.id, { path: p, content: text, note: note })
      .then(wrote); },
    remove: function (p) { return o.data.deleteWorkspaceFile(o.id, p).then(wrote); },
    move: function (a, b) { return o.data.moveWorkspaceFile(o.id, a, b).then(wrote); },
  };
  s.shell = createShell({
    fs: fs, print: print,
    clear: function () { s.log = []; if (s.view) s.view('clear'); },
    open: function (p) { o.onOpen(p); },
    files: function () {
      return o.data.workspaceBundle(o.id).then(function (d) {
        var m = {};
        (d.files || []).forEach(function (f) { if (f.encoding !== 'base64') m[f.path] = f.content; });
        return m;
      });
    },
    run: function (lang, code, opts) {
      if (!s.runner) s.runner = createRunner();
      return s.runner.run(lang, code, opts);
    },
  });
  print('info', 'Colon terminal. Type help to see the commands. Code runs on your phone.');
  return s;
}

function mount(el, o) {
  var s = session(o), pos = s.inputs.length, busy = false;
  el.innerHTML = '<div class="wk-term"><pre class="wk-term-out" data-out aria-live="polite"></pre><form '
    + 'class="wk-term-in" novalidate autocomplete="off"><span class="wk-term-ps" data-ps></span><input data-in '
    + 'autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Command"></form>'
    + '<div class="wk-term-keys"><button type="button" data-k="up" aria-label="Previous command">↑</button>'
    + '<button type="button" data-k="down" aria-label="Next command">↓</button><button type="button" data-ins=" > ">'
    + '&gt;</button><button type="button" data-ins="&quot;">"</button><button type="button" data-ins="/">/</button>'
    + '<button type="button" data-k="stop" class="wk-term-stop">' + icon('stop') + 'Stop</button><button '
    + 'type="button" data-k="clear">Clear</button></div></div>';
  var out = el.querySelector('[data-out]'), input = el.querySelector('[data-in]'), ps = el.querySelector('[data-ps]');

  function line(kind, text) {
    var d = document.createElement('div');
    d.className = 'wk-t-' + kind; d.textContent = text === '' ? '\u00a0' : text;
    out.appendChild(d);
  }
  function draw() { out.innerHTML = ''; s.log.forEach(function (l) { line(l[0], l[1]); }); bottom(); }
  function bottom() { out.scrollTop = out.scrollHeight; }
  s.view = function (kind, text) {
    if (!el.isConnected) { s.view = null; return; }
    if (kind === 'clear') { out.innerHTML = ''; return; }
    String(text).split('\n').forEach(function (l) { line(kind, l); });
    while (out.childNodes.length > MAX_LINES) out.removeChild(out.firstChild);
    bottom();
  };
  function setPs() { ps.textContent = s.shell.prompt(); }
  function submit() {
    var v = input.value;
    if (busy) return;
    input.value = '';
    if (v.trim()) { s.inputs.push(v); if (s.inputs.length > 200) s.inputs.shift(); }
    pos = s.inputs.length;
    busy = true; el.classList.add('busy');
    s.shell.exec(v).then(function () {
      busy = false; el.classList.remove('busy'); setPs();
      if (el.isConnected) input.focus();
    });
  }
  function recall(d) {
    if (!s.inputs.length) return;
    pos = Math.max(0, Math.min(s.inputs.length, pos + d));
    input.value = s.inputs[pos] || '';
    input.focus();
  }
  el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp') { e.preventDefault(); recall(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); recall(1); }
    else if (e.key === 'c' && e.ctrlKey && s.runner) { e.preventDefault(); s.runner.stop(); }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); s.shell.exec('clear'); }
  });
  el.querySelectorAll('[data-k]').forEach(function (b) { b.addEventListener('click', function () {
    var k = b.getAttribute('data-k');
    if (k === 'up') recall(-1);
    else if (k === 'down') recall(1);
    else if (k === 'stop') { if (s.runner && s.runner.busy()) s.runner.stop(); else C.toast('Nothing is running.'); }
    else if (k === 'clear') { s.log = []; out.innerHTML = ''; input.focus(); }
  }); });
  el.querySelectorAll('[data-ins]').forEach(function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-ins'), a = input.selectionStart || input.value.length;
      input.value = input.value.slice(0, a) + t + input.value.slice(input.selectionEnd || a);
      input.focus(); input.setSelectionRange(a + t.length, a + t.length);
    });
  });
  out.addEventListener('click', function () { if (!window.getSelection().toString()) input.focus(); });
  setPs(); draw();
  return { dispose: function () { s.view = null; } };
}


export { mount };
