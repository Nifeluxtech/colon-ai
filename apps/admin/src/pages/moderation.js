/* Colon Admin · Moderation: reported shared chats and acting on a report. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { act, area } from '../components/form.js';
import { chips, fail, head, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Moderation ================= */
function moderation(view) {
  gate(view, function () {
    var status = 'open', kind = '';
    view.innerHTML = head('Moderation', 'Bad feedback on replies and reports on shared chats.') +
      chips([['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']], 'open', 'data-s')
        +
      '<div style="margin-top:8px">' + chips([['', 'Everything'], ['feedback', 'Bad feedback'], ['share',
        'Shared-link reports']], '', 'data-k') + '</div><div class="list" id="ml" style="margin-top:12px"></div>';
    function load() {
      $('#ml', view).innerHTML = skel(3);
      C.api('/admin/moderation?status=' + status + '&kind=' + kind).then(function (d) {
        if (!d.reports.length) { $('#ml', view).innerHTML = '<div class="empty">' + icon('check')
          + '<p>Nothing here.</p></div>'; return; }
        $('#ml', view).innerHTML = d.reports.map(function (m) {
          return '<button class="row" data-id="' + m.id + '"><span class="ico" style="color:' + (m.kind === 'share'
            ? 'var(--bad)' : 'var(--warn)') + '">' + icon(m.kind === 'share' ? 'link' : 'thumbDown')
            + '</span><span class="body"><div class="title">' + esc(m.reason || 'Reported') + '</div>' +
            '<div class="sub">' + esc(m.title || 'Conversation removed') + (m.comment ? ' · “' + esc(m.comment.slice(0,
              80)) + '”' : '') + '</div>' +
            '<div class="adm-badges"><span class="badge">' + (m.kind === 'share' ? 'Shared link' : 'Feedback')
              + '</span>' + (m.status !== 'open' ? '<span class="badge ' + (m.status === 'resolved' ? 'ok' : '') + '">'
              + esc(m.status) + '</span>' : '') + (m.kind === 'share' && m.shared
              ? '<span class="badge warn">Link live</span>' : '')
              + '</div></span><span class="tiny muted" style="flex:none">' + C.ago(m.created_at) + '</span></button>';
        }).join('');
        $$('[data-id]', view).forEach(function (b) { b.addEventListener('click', function () { report(b.getAttribute(
          'data-id'), load); }); });
      }).catch(function (e) { fail($('#ml', view), e); });
    }
    function pick(attr, fn) { $$('[' + attr + ']', view).forEach(function (b) { b.addEventListener('click',
      function () { fn(b.getAttribute(attr)); $$('[' + attr + ']', view).forEach(function (x) { x.classList.toggle(
      'on', x === b); x.setAttribute('aria-pressed', x === b); }); load(); }); }); }
    pick('data-s', function (v) { status = v; }); pick('data-k', function (v) { kind = v; });
    load();
  });
}

function report(id, reload) {
  C.api('/admin/moderation/' + id).then(function (d) {
    var r = d.report, c = d.conversation;
    C.sheet('<div class="h2">' + esc(r.reason || 'Report') + '</div><p class="small muted">' + (r.kind === 'share'
      ? 'Report on a shared link' : 'Bad feedback on a reply') + ' · ' + C.ago(r.created_at) + (c ? ' · “'
      + esc(c.title) + '” (' + esc(c.mode) + ')' : '') + '</p>' +
      (r.comment ? '<div class="card small">' + esc(r.comment) + '</div>' : '') +
      (d.gone ? '<p class="small muted">' + icon('info')
        + ' The conversation was deleted, so only the report is left.</p>' : d.hidden ? '<p class="small muted">'
        + icon('lock') + ' This person turned off sharing feedback context, so only the reason is shown.</p>' : '') +
      (d.messages.length ? '<div class="adm-thread">' + d.messages.map(function (m) { return '<div class="adm-msg '
        + m.role + '"><div class="tiny muted">' + (m.role === 'user' ? 'User' : 'Colon' + (m.model ? ' · '
        + esc(m.model) : '')) + '</div>' + esc(m.content) + '</div>'; }).join('') + '</div>' : '') +
      '<form class="form" novalidate style="margin-top:12px">' + area('note', 'Note (optional, kept with the report)',
        r.note) +
      (r.status === 'open' ? '<button class="btn primary block" type="submit" data-do="resolve">Resolve</button>'
        + (r.kind === 'share' && c && c.shared
        ? '<button class="btn danger block" type="button" data-do="unshare">Resolve and turn off the link</button>' :
        '') + '<button class="btn block" type="button" data-do="dismiss">Dismiss</button>'
        : '<p class="small muted">Marked ' + esc(r.status)
          + '.</p><button class="btn block" type="button" data-do="reopen">Reopen</button>') +
      '<button class="btn ghost block" type="button" data-close>Close</button></form>', function (el, close) {
      function go(what) {
        var note = $('textarea', el).value;
        var path = what === 'unshare' ? 'resolve' : what;
        act(C.api('/admin/moderation/' + r.id + '/' + path, { method: 'POST', body: { note: note,
          unshare: what === 'unshare' } }), function () { C.toast(what === 'dismiss' ? 'Dismissed.' : what === 'reopen'
          ? 'Reopened.' : 'Resolved.', 'ok'); close(); reload(); });
      }
      $('form', el).addEventListener('submit', function (e) { e.preventDefault(); go('resolve'); });
      $$('[data-do]', el).forEach(function (b) { if (b.type !== 'submit') b.addEventListener('click', function () { go(
        b.getAttribute('data-do')); }); });
    });
  }).catch(function (e) { C.toast(e.message, 'bad'); });
}

export { moderation };
