/* Colon AI · Workspace chat tab (v0.26.0, Workspace step 2; plan: docs/workspace/plan.md). The user describes the
   site; Colon writes or edits its files. POST /workspaces/:id/chat starts a reply in the background and GET polls
   it (every 1.5 s while "working"; live steps since v0.27.2), so a long build never hangs a request. Each reply
   shows the files it changed and, while it is still the newest change, an Undo that restores the version from
   before it. mount(el, o) where
   o = { id, data, onChanged, send? }: onChanged() runs after the files change (the page refreshes its file list);
   send (v0.27.0): a message to send as soon as the chat is free, e.g. the Preview tab's "Fix it";
   onAction (v0.31.2): a tab command from the chat, such as 'open_preview' or 'open_site'. */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { chipsHtml, openPlus, editInstructions, forget } from './workspace-plus.js';
import { secretSheet, tableSheet } from './workspace-data-forms.js';
import { connectSheet } from './workspace-connect.js';
import { downloadZip } from './workspace-export.js';
import { split as splitNeeds, met } from '../lib/ws-needs.js';

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
var NEED = { secret: ['key', function (x) { return 'Add the ' + x + ' key'; }, 'Add key'],
  table: ['database', function (x) { return 'Create the “' + x + '” table'; }, 'Create'],
  connection: ['users', function (x) { return 'Connect ' + x.charAt(0).toUpperCase() + x.slice(1); }, 'Connect'],
  // v0.31.0: Colon's "=== EXPORT: zip" line (the user asked for their files as a zip)
  zip: ['download', function () { return 'Your files as a ZIP'; }, 'Download ZIP'] };
// v0.29.0 (step 5): a table or key the build needs shows as a card; done once the Data tab has it.
function needsHtml(m, needs, dnow) {
  return needs.map(function (n, i) {
    var done = met(n, dnow), k = NEED[n.kind === 'export' ? 'zip' : n.kind] || NEED.table;
    return '<div class="wk-need' + (done ? ' wk-need-ok' : '') + '">' + icon(k[0])
      + '<span><b>' + esc(k[1](n.name)) + '</b>'
      + (n.why ? '<small>' + esc(n.why) + '</small>' : '') + '</span>' + (done ? '<em>' + icon('check') + 'Done</em>'
      : '<button type="button" class="btn sm primary" data-need="' + m.id + ':' + i + '">' + k[2] + '</button>')
      + '</div>';
  }).join('');
}
function msgHtml(m, current, dnow) {
  if (m.role === 'user') return '<div class="wk-msg wk-me">' + textHtml(m.content) + (m.kind === 'queued'
    ? '<span class="wk-q">' + icon('clock') + 'Queued: builds next</span>' : m.kind === 'dropped' || m.kind
    === 'stopped' ? '<span class="wk-q">' + icon('alert') + 'Stopped: not built</span>' : '') + '</div>';
  var undo = !m.error && m.version_after != null && m.version_after === current, sp = splitNeeds(m.content);
  return '<div class="wk-msg wk-colon' + (m.error ? ' wk-err' : '') + '">' + (m.error ? icon('alert') : '')
    + doneSteps(m) + '<p>' + textHtml(sp.text) + '</p>' + needsHtml(m, sp.needs, dnow) + changesHtml(m, undo)
    + '</div>';
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
    live = new Date(h.now).getTime() - (cur.at || new Date(me.created_at).getTime() + (cur.start || 0));
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
    + '</div><form class="wk-compose" novalidate><div class="wk-ctx" data-ctxs></div><div class="wk-row-in">'
    + '<button type="button" class="icon-btn wk-plus" aria-label="Add: clone, learn, instructions" '
    + 'aria-haspopup="menu" data-plus>' + icon('plus') + '</button><textarea rows="1" maxlength="4000" data-in '
    + 'aria-label="Message '
    + 'Colon" placeholder="Describe your site or a change…"></textarea><button type="submit" class="icon-btn '
    + 'wk-send" aria-label="Send">' + icon('send') + '</button></div><button type="button" class="cw-jump btn sm" '
    + 'data-jump hidden aria-label="Scroll to the latest message">' + icon('chevDown') + 'Latest</button></form></div>';
  var list = el.querySelector('.wk-msgs'), form = el.querySelector('form'), input = el.querySelector('[data-in]');
  var send = el.querySelector('.wk-send'), ctxs = el.querySelector('[data-ctxs]'), lastH = null, note = null;
  // v0.27.3: the + menu (clone / learn from a repository, instructions) and the chips for what is on
  var po = { id: id, data: data, onDone: function () { load(); if (o.onChanged) o.onChanged(); },
    onBusy: function (t) { note = t; if (lastH) render(lastH); } };
  el.querySelector('[data-plus]').addEventListener('click', function (e) {
    po.h = lastH; openPlus(e.currentTarget, po); });
  ctxs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ctx]');
    if (!b) return;
    po.h = lastH;
    if (b.getAttribute('data-ctx') === 'instr') editInstructions(po); else forget(po);
  });
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
    lastH = h;
    ctxs.innerHTML = chipsHtml(h);
    var tail = note ? '<div class="wk-msg wk-colon wk-working" role="status"><div class="wk-work-h"><span '
      + 'class="wk-dots"><i></i><i></i><i></i></span>' + esc(note) + '</div></div>' : h.working ? workingHtml(h, msgs)
      : msgs.length && msgs[msgs.length - 1].role === 'user' ? LOST : '';
    list.innerHTML = msgs.length ? msgs.map(function (m) { return msgHtml(m, h.version, dnow); }).join('')
      + tail : '<div class="wk-ideas"><p>What should we build? Describe it in your own '
      + 'words, or start with an idea:</p>' + IDEAS.map(function (t) {
        return '<button type="button" class="wk-idea" data-idea="' + esc(t) + '">' + icon('sparkles') + esc(t)
          + '</button>';
      }).join('') + '</div>';
    list.querySelectorAll('[data-idea]').forEach(function (b) { b.addEventListener('click', function () {
      input.value = b.getAttribute('data-idea'); grow(); input.focus(); }); });
    list.querySelectorAll('[data-need]').forEach(function (b) { b.addEventListener('click', function () {
      var k = b.getAttribute('data-need').split(':');
      var m = msgs.filter(function (x) { return String(x.id) === k[0]; })[0];
      var n = m && splitNeeds(m.content).needs[Number(k[1])];
      var fo = { id: id, data: data, onSaved: needData };
      if (n && n.kind === 'export') downloadZip(data, id, b);
      else if (n && n.kind === 'connection') { if (dnow) connectSheet(fo, dnow, n.name); }
      else if (n) (n.kind === 'secret' ? secretSheet : tableSheet)(fo, n);
    }); });
    list.querySelectorAll('[data-undo]').forEach(function (b) { b.addEventListener('click', function () {
      undo(Number(b.getAttribute('data-undo'))); }); });
    list.querySelectorAll('details[data-mid]').forEach(function (d) {
      if (open[d.getAttribute('data-mid')]) d.open = true; });
    var sig = msgs.length + ':' + h.working + ':' + note;   // scroll only when something new arrives, not on every poll
    var first = !seen;
    if (sig === seen) return;
    seen = sig;
    if (first || stick) toEnd(); else jump.hidden = false;
  }
  // v0.29.0: open on the newest message, follow new ones while at the bottom, ↓ button when scrolled up.
  var jump = el.querySelector('[data-jump]'), stick = true, box = null;
  function scroller() {
    for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      var y = getComputedStyle(n).overflowY;
      if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  }
  function gap() { box = box && box.isConnected ? box : scroller(); return box.scrollHeight - box.scrollTop
    - box.clientHeight; }
  function toEnd() {
    var go = function () { box = scroller(); box.scrollTop = box.scrollHeight; stick = true; jump.hidden = true; };
    go(); requestAnimationFrame(go); setTimeout(go, 350);
  }
  function onScroll() { if (!el.isConnected) return off(); stick = gap() < 120; if (stick) jump.hidden = true; }
  function off() { window.removeEventListener('scroll', onScroll, true); }
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  jump.addEventListener('click', toEnd);
  var dnow = null;
  function needData() {   // what the Data tab already has, so met needs show as Done
    if (data.workspaceData) data.workspaceData(id).then(function (d) { dnow = d; if (lastH) render(lastH); })
      .catch(function () {});
  }
  needData();
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
    // v0.31.4: the request stays open while a build runs (hold), so after 2 s the composer frees and the poll
    // shows the build; the reply ending the request just reloads. A late network drop is not an error.
    var freed = false, early = setTimeout(function () {
      freed = true; setBusy(false); input.value = ''; grow(); load();
    }, 2000);
    data.sendWorkspaceChat(id, text).then(function (r) {
      clearTimeout(early);
      if (!freed) { setBusy(false); input.value = ''; grow(); }
      // v0.31.2: a tab command ("open browser", "show the code") answers at once; the page switches tab
      if (r && r.action && o.onAction) { load().then(function () { o.onAction(r.action); }); return; }
      load();
    })
      .catch(function (err) {
        clearTimeout(early);
        if (freed && !(err.status >= 400 && err.status < 500)) { load(); return; }
        setBusy(false);
        C.toast(err.message, 'bad', err.code === 'quota' || err.status === 429 ? { label: 'See plans',
          fn: function () { C.go('/account/plan'); } } : undefined);
      });
  });
  load();
  return { refresh: load };
}
