/* Colon AI · code editor for Developer mode (v0.17.0, roadmap item 17).
   Each code block in a reply gets an Edit button while the chat is in Developer mode. Monaco (monaco-editor,
   pinned in lib/chat-tools.js) is loaded from jsDelivr only when Edit is tapped; if the CDN is blocked (CSP), fails
   or is slow, a plain textarea is used instead. Editing only: running code isn't available yet. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { $, mode } from '../core/state.js';
import { MONACO_BASE, MONACO_TIMEOUT_MS, monacoLanguage, monacoWorkerUrl, withTimeout } from '../lib/chat-tools.js';
import { autoGrow, syncComposer } from './composer.js';

var C = Colon, icon = C.icon, esc = C.esc;
var monaco = null;   // Promise<window.monaco>, once per page (a failure is cleared so a later tap can retry)

/** Adds Edit beside Copy on finished code blocks (Developer mode only). */
function decorateCode(root) {
  if (mode() !== 'developer' || !root) return;
  root.querySelectorAll('.cw-msg.ai .md-code:not(.streaming) .md-code-head').forEach(function (head) {
    if (head.querySelector('[data-edit-code]')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'md-copy'; b.setAttribute('data-edit-code', ''); b.textContent = 'Edit';
    b.setAttribute('aria-label', 'Edit this code');
    head.insertBefore(b, head.querySelector('[data-copy-code]'));
  });
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = function () { s.remove(); reject(new Error('The editor couldn’t load.')); };
    document.head.appendChild(s);
  });
}
function loadMonaco() {
  if (window.monaco && window.monaco.editor) return Promise.resolve(window.monaco);
  if (monaco) return monaco;
  var p = (window.require && window.require.config ? Promise.resolve() : loadScript(MONACO_BASE + '/vs/loader.js'))
    .then(function () {
      window.MonacoEnvironment = { getWorkerUrl: function () { return monacoWorkerUrl(MONACO_BASE); } };
      window.require.config({ paths: { vs: MONACO_BASE + '/vs' } });
      return new Promise(function (resolve, reject) {
        window.require(['vs/editor/editor.main'], function () { resolve(window.monaco); }, reject);
      });
    });
  monaco = withTimeout(p, MONACO_TIMEOUT_MS).catch(function (e) { monaco = null; throw e; });
  return monaco;
}

/** Opens the editor for the code block that holds `btn`. */
function openCodeEditor(btn) {
  var block = btn.closest('.md-code'); if (!block) return;
  var code = block.querySelector('code').textContent, label = (block.querySelector('.md-code-head span') || {})
    .textContent || 'text', editor = null, ta = null;
  C.sheet('<div class="h2">' + icon('code') + 'Edit code <span class="badge">' + esc(label) + '</span></div>'
    + '<div class="cw-editor" data-editor><div class="cw-editor-loading small muted">Loading the editor…</div></div>'
    + '<p class="tiny muted cw-editor-note">Editing only: running code isn’t available yet.</p>'
    + '<div class="sheet-actions"><button type="button" class="btn ghost" data-close>Close</button>'
    + '<button type="button" class="btn" data-ed="copy">' + icon('copy') + 'Copy</button>'
    + '<button type="button" class="btn primary" data-ed="use">Use in message</button></div>',
  function (el, close) {
    var box = el.querySelector('[data-editor]');
    function value() { return editor ? editor.getValue() : ta ? ta.value : code; }
    function fallback(why) {
      if (!el.isConnected || editor || ta) return;
      box.innerHTML = '<textarea class="textarea mono cw-editor-ta" spellcheck="false" aria-label="Code"></textarea>'
        + (why ? '<p class="tiny muted">The full editor couldn’t load here, so this is a plain text box.</p>' : '');
      ta = box.querySelector('textarea'); ta.value = code; ta.focus();
    }
    loadMonaco().then(function (m) {
      if (!el.isConnected) return;
      box.innerHTML = '';
      editor = m.editor.create(box, { value: code, language: monacoLanguage(label), automaticLayout: true,
        minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on',
        theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark' });
      editor.focus();
    }, function () { fallback(true); });
    el.querySelector('[data-ed=copy]').addEventListener('click', function () {
      C.copyText(value()).then(function () { C.toast('Copied.'); }, function () { C.toast('Couldn’t copy.', 'bad'); });
    });
    el.querySelector('[data-ed=use]').addEventListener('click', function () {
      var input = $('#cw-input'), fence = '```' + (label === 'text' ? '' : label) + '\n' + value().replace(/\n$/, '')
        + '\n```';
      input.value = input.value.trim() ? input.value.replace(/\s+$/, '') + '\n\n' + fence : fence;
      autoGrow(); syncComposer(); close(); input.focus();
    });
  }, { cls: 'wide', label: 'Edit code', onClose: function () { if (editor) editor.dispose(); } });
}

export { decorateCode, loadMonaco, openCodeEditor };
