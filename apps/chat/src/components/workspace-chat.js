/* Colon AI · Workspace chat tab (v0.26.0, Workspace step 2; plan: docs/workspace/plan.md). The user describes the
   site; Colon writes or edits its files. POST /workspaces/:id/chat starts a reply in the background and GET polls it
   (every 2.5 s while "working"), so a long build never hangs a request. Each reply shows the files it changed and,
   while it is still the newest change, an Undo that restores the version from before it. mount(el, o) where
   o = { id, data, onChanged, send? }: onChanged() runs after the files change (the page refreshes its file list);
   send (v0.27.0): a message to send as soon as the chat is free, e.g. the Preview tab's "Fix it". */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
var POLL_MS = 2500;
var IDEAS = ['A one-page site for my bakery with a menu, opening hours and contact form',
  'A personal portfolio with my projects, an about section and links',
  'A landing page for my app with features, pricing and a sign-up button'];
var OPS = { created: ['plus', 'Created'], edited: ['edit', 'Edited'], deleted: ['trash', 'Deleted'] };

function textHtml(s) { return esc(s).replace(/\n/g, '<br>'); }
function changesHtml(m, undo) {
  if (!m.changes.length) return '';
  return '<div class="wk-changes"><b>' + (m.changes.length === 1 ? '1 file changed' : m.changes.length
    + ' files changed') + '</b><ul>' + m.changes.map(function (c) {
    var o = OPS[c.op] || OPS.edited;
    return '<li class="wk-ch-' + esc(c.op) + '">' + icon(o[0]) + '<span>' + esc(o[1]) + '</span><code>'
      + esc(c.path) + '</code></li>';
  }).join('') + '</ul>' + (undo ? '<button type="button" class="btn sm ghost" data-undo="' + m.version_before
    + '">' + icon('refresh') + 'Undo</button>' : '') + '</div>';
}
function msgHtml(m, current) {
  if (m.role === 'user') return '<div class="wk-msg wk-me">' + textHtml(m.content) + '</div>';
  var undo = !m.error && m.version_after != null && m.version_after === current;
  return '<div class="wk-msg wk-colon' + (m.error ? ' wk-err' : '') + '">' + (m.error ? icon('alert') : '')
    + '<p>' + textHtml(m.content) + '</p>' + changesHtml(m, undo) + '</div>';
}
var WORKING = '<div class="wk-msg wk-colon wk-working" role="status"><span class="wk-dots"><i></i><i></i><i></i>'
  + '</span>Colon is building your site…</div>';

var LOST = '<div class="wk-msg wk-colon wk-err">' + icon('alert') + '<p>Colon didn’t answer this one. Nothing '
  + 'was changed; please send it again.</p></div>';

export function mount(el, o) {
  var data = o.data, id = o.id, timer = null, lastVersion = null, busy = false;
  el.innerHTML = '<div class="wk-chat"><div class="wk-msgs" aria-live="polite"><div class="skel px-skel-c"></div>'
    + '</div><form class="wk-compose" novalidate><textarea rows="1" maxlength="4000" data-in aria-label="Message '
    + 'Colon" placeholder="Describe your site or a change…"></textarea><button type="submit" class="icon-btn '
    + 'wk-send" aria-label="Send">' + icon('send') + '</button></form></div>';
  var list = el.querySelector('.wk-msgs'), form = el.querySelector('form'), input = el.querySelector('[data-in]');
  var send = el.querySelector('.wk-send');

  function setBusy(b) { busy = b; send.disabled = b; input.disabled = b; }
  function render(h) {
    var msgs = h.messages || [];
    var tail = h.working ? WORKING : msgs.length && msgs[msgs.length - 1].role === 'user' ? LOST : '';
    list.innerHTML = msgs.length ? msgs.map(function (m) { return msgHtml(m, h.version); }).join('')
      + tail : '<div class="wk-ideas"><p>What should we build? Describe it in your own '
      + 'words, or start with an idea:</p>' + IDEAS.map(function (t) {
        return '<button type="button" class="wk-idea" data-idea="' + esc(t) + '">' + icon('sparkles') + esc(t)
          + '</button>';
      }).join('') + '</div>';
    list.querySelectorAll('[data-idea]').forEach(function (b) { b.addEventListener('click', function () {
      input.value = b.getAttribute('data-idea'); grow(); input.focus(); }); });
    list.querySelectorAll('[data-undo]').forEach(function (b) { b.addEventListener('click', function () {
      undo(Number(b.getAttribute('data-undo'))); }); });
    list.scrollTop = list.scrollHeight;
    var main = el.closest('.cw-screen');
    if (main && msgs.length) main.scrollTop = main.scrollHeight;
  }
  function load() {
    clearTimeout(timer);
    if (!el.isConnected) return Promise.resolve();
    return data.workspaceChat(id).then(function (h) {
      if (!el.isConnected) return;
      render(h);
      setBusy(h.working);
      if (lastVersion !== null && h.version !== lastVersion && o.onChanged) o.onChanged();
      lastVersion = h.version;
      if (h.working) timer = setTimeout(load, POLL_MS);
      if (o.send && !h.working) { input.value = o.send; o.send = null; grow(); form.requestSubmit(); }
    }).catch(function (e) {
      if (!el.isConnected) return;
      list.innerHTML = '<p class="px-empty">The chat didn’t load. ' + esc(e.message) + '</p>';
      timer = setTimeout(load, POLL_MS * 4);
    });
  }
  function undo(n) {
    data.restoreWorkspace(id, n).then(function () { C.toast('Change undone.', 'ok'); load(); })
      .catch(function (e) { C.toast(e.message, 'bad'); });
  }
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }
  input.addEventListener('input', grow);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    setBusy(true);
    data.sendWorkspaceChat(id, text).then(function () { input.value = ''; grow(); load(); })
      .catch(function (err) {
        setBusy(false);
        C.toast(err.message, 'bad', err.code === 'quota' || err.status === 429 ? { label: 'See plans',
          fn: function () { C.go('/account/plan'); } } : undefined);
      });
  });
  load();
  return { refresh: load };
}
