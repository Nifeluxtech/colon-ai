/* Colon AI · Workspace chat tab (v0.26.0, Workspace step 2; plan: docs/workspace/plan.md). The user describes the
   site; Colon writes or edits its files. POST /workspaces/:id/chat starts a reply in the background and GET polls
   it (every 1.5 s while "working"; live steps since v0.27.2), so a long build never hangs a request. Each reply
   shows the files it changed and, while it is still the newest change, an Undo that restores the version from
   before it. mount(el, o) where
   o = { id, data, onChanged, send? }: onChanged() runs after the files change (the page refreshes its file list);
   send (v0.27.0): a message to send as soon as the chat is free, e.g. the Preview tab's "Fix it". */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
var POLL_MS = 1500;
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
  if (m.role === 'user') return '<div class="wk-msg wk-me">' + textHtml(m.content) + (m.kind === 'queued'
    ? '<span class="wk-q">' + icon('clock') + 'Queued: builds next</span>' : '') + '</div>';
  var undo = !m.error && m.version_after != null && m.version_after === current;
  return '<div class="wk-msg wk-colon' + (m.error ? ' wk-err' : '') + '">' + (m.error ? icon('alert') : '')
    + doneSteps(m) + '<p>' + textHtml(m.content) + '</p>' + changesHtml(m, undo) + '</div>';
}
// v0.27.2: the steps Colon took (or is taking) for a reply, like other assistants show their tools.
function secs(ms) { var n = Math.max(0, Math.round(ms / 1000)); return n < 60 ? n + 's' : Math.floor(n / 60) + 'm '
  + (n % 60) + 's'; }
function stepsHtml(steps, live) {
  return '<ol class="wk-steps">' + steps.map(function (x) {
    var mark = x.state === 'run' ? '<span class="wk-spin" aria-hidden="true"></span>' : icon(x.state === 'fail'
      ? 'alert' : 'check');
    var time = x.state === 'run' ? '<span class="wk-t" data-tick="' + (live || 0) + '">' + secs(live || 0)
      + '</span>' : x.ms > 400 ? '<span class="wk-t">' + secs(x.ms) + '</span>' : '';
    return '<li class="wk-st-' + esc(x.state) + '">' + mark + '<span class="wk-st-b"><span>' + esc(x.label)
      + '</span>' + (x.detail ? '<small>' + esc(x.detail) + '</small>' : '') + '</span>' + time + '</li>';
  }).join('') + '</ol>';
}
function doneSteps(m) {
  if (!m.steps || !m.steps.length) return '';
  var last = m.steps[m.steps.length - 1], total = (last.start || 0) + (last.ms || 0);
  return '<details class="wk-steps-box" data-mid="' + m.id + '"><summary>' + icon('check') + m.steps.length
    + ' steps · ' + secs(total)
    + '</summary>' + stepsHtml(m.steps) + '</details>';
}
function workingHtml(h, msgs) {
  var users = msgs.filter(function (m) { return m.role === 'user' && m.kind !== 'side' && m.kind !== 'queued'; });
  var me = users.filter(function (m) { return m.kind === 'running'; }).pop() || users.pop();
  var steps = me && me.steps && me.steps.length ? me.steps : null;
  var cur = steps && steps[steps.length - 1], live = 0;
  if (cur && cur.state === 'run' && h.now) {
    live = new Date(h.now).getTime() - new Date(me.created_at).getTime() - (cur.start || 0);
  }
  return '<div class="wk-msg wk-colon wk-working" role="status"><div class="wk-work-h"><span class="wk-dots"><i></i>'
    + '<i></i><i></i></span>' + (cur ? esc(cur.label) + '…' : 'Starting…') + '</div>'
    + (steps ? stepsHtml(steps, live) : '') + '</div>';
}

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
  var tick = setInterval(function () {   // the timer of the running step counts up between polls
    if (!el.isConnected) { clearInterval(tick); return; }
    el.querySelectorAll('[data-tick]').forEach(function (t) {
      var ms = Number(t.getAttribute('data-tick')) + 1000;
      t.setAttribute('data-tick', ms); t.textContent = secs(ms);
    });
  }, 1000);

  // v0.27.2: the composer stays open while Colon builds (questions get a quick answer, changes queue).
  var idle = input.placeholder, seen = '';
  function setBusy(b) { busy = b; send.disabled = b; }
  function render(h) {
    var msgs = h.messages || [], open = {};
    list.querySelectorAll('details[open][data-mid]').forEach(function (d) { open[d.getAttribute('data-mid')] = 1; });
    input.placeholder = h.working ? 'Ask or add a change…' : idle;
    var tail = h.working ? workingHtml(h, msgs) : msgs.length && msgs[msgs.length - 1].role === 'user' ? LOST : '';
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
    list.querySelectorAll('details[data-mid]').forEach(function (d) {
      if (open[d.getAttribute('data-mid')]) d.open = true; });
    var sig = msgs.length + ':' + h.working;   // scroll only when something new arrives, not on every poll
    if (sig === seen) return;
    seen = sig;
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
