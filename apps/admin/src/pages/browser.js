/* Colon Admin · Browser: Saga's browsing tasks on users' phones (Phase 9) and the step-by-step replay of each one
   (what Saga said it was doing, the command, approvals tapped on the phone, the result and the page). Read-only;
   the server never stores page text, and typed personal data is hidden in the log. Opening a replay is audited. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { chips, fail, head, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

var STATUS = { queued: 'Waiting for the phone', consent: 'Asking the user', running: 'Running', done: 'Done',
  step_limit: 'Step limit', timeout: 'Timed out', stopped: 'Stopped', interrupted: 'Interrupted',
  failed: 'Failed', handoff: 'Waiting for the user', user_control: 'User has the browser', paused: 'Paused' };
var TONE = { done: 'ok', failed: 'bad', timeout: 'bad', step_limit: 'warn', interrupted: 'warn', stopped: '' };
var APPROVAL = { payment: 'Payment', purchase: 'Purchase', send_message: 'Message', form_submission: 'Form',
  personal_data: 'Personal data', shared: 'Shared step', phone: 'Phone check' };

function badge(text, tone) { return '<span class="badge ' + (tone || '') + '">' + esc(text) + '</span>'; }

/* ================= Browser ================= */
function browser(view) {
  gate(view, function () {
    var status = '';
    view.innerHTML = head('Browser', 'Saga’s browsing tasks on users’ phones. Every step is logged and can be '
      + 'replayed; page text is never stored.') +
      chips([['', 'All'], ['running', 'Running'], ['done', 'Done'], ['failed', 'Failed'], ['interrupted',
        'Taken over'], ['stopped', 'Stopped']], '', 'data-s') +
      '<div class="list" id="bl" style="margin-top:12px"></div>';
    function load() {
      $('#bl', view).innerHTML = skel(3);
      C.api('/admin/saga/tasks?status=' + encodeURIComponent(status)).then(function (d) {
        if (!d.tasks.length) { $('#bl', view).innerHTML = '<div class="empty">' + icon('compass')
          + '<p>No Saga browsing tasks yet.</p></div>'; return; }
        $('#bl', view).innerHTML = d.tasks.map(function (t) {
          return '<button class="row" data-id="' + t.id + '"><span class="ico">' + icon('compass') + '</span>'
            + '<span class="body"><div class="title">' + esc(t.goal.slice(0, 120)) + '</div><div class="sub">'
            + esc(t.user_email || 'Deleted account') + ' · ' + t.steps + ' steps' + (t.error ? ' · ' + esc(t.error)
            : '') + '</div><div class="adm-badges">' + badge(STATUS[t.status] || t.status, TONE[t.status])
            + '</div></span><span class="tiny muted" style="flex:none">' + C.ago(t.created_at) + '</span></button>';
        }).join('');
        $$('[data-id]', view).forEach(function (b) { b.addEventListener('click', function () {
          replay(b.getAttribute('data-id')); }); });
      }).catch(function (e) { fail($('#bl', view), e); });
    }
    $$('[data-s]', view).forEach(function (b) { b.addEventListener('click', function () {
      status = b.getAttribute('data-s');
      $$('[data-s]', view).forEach(function (x) { x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b); });
      load(); }); });
    load();
  });
}

function step(a) {
  var what = a.kind === 'action' ? (a.say || a.tool) : a.kind === 'control' ? 'Asked the user: “Let Saga browse?” → '
    + (a.error || '') : a.kind === 'finish' ? 'Finished and answered' : a.kind === 'end' ? 'Ended: ' + (a.error || '')
    : a.kind === 'handoff' ? 'Asked the user: ' + (a.say || a.error || '') : a.kind === 'continue' ? (a.say
    || 'Continues an earlier task') : 'Refused or failed: ' + (a.error || '');
  var args = a.args && Object.keys(a.args).length ? JSON.stringify(a.args) : '';
  return '<div class="row"><span class="ico">' + (a.seq) + '</span><span class="body"><div class="title">'
    + esc(what) + '</div><div class="sub">' + (a.command ? esc(a.command) + (args ? ' ' + esc(args.slice(0, 200)) : '')
    : '') + (a.url ? ' · ' + esc(a.url.slice(0, 120)) : '') + (a.ms != null ? ' · ' + a.ms + ' ms' : '') + '</div>'
    + '<div class="adm-badges">' + (a.ok === false ? badge(a.error || 'failed', 'bad') : a.ok ? badge('ok', 'ok') : '')
    + (a.approval ? badge((APPROVAL[a.approval] || a.approval) + ': ' + (a.approved || 'none'), a.approved
      === 'approved' ? 'ok' : 'warn') : '') + (a.page ? badge('Page ' + a.page) : '') + '</div></span></div>';
}

function replay(id) {
  C.api('/admin/saga/tasks/' + encodeURIComponent(id)).then(function (d) {
    var t = d.task;
    C.sheet('<div class="h2">' + esc(t.goal.slice(0, 160)) + '</div><p class="small muted">'
      + esc(STATUS[t.status] || t.status) + (t.error ? ' (' + esc(t.error) + ')' : '') + ' · ' + t.steps + ' steps · '
      + C.ago(t.created_at) + '</p>' +
      (t.answer ? '<div class="card small">' + esc(t.answer) + '</div>' : '') +
      (t.sources.length ? '<div class="section-title">Pages cited</div><div class="list">'
        + t.sources.map(function (s) {
        return '<div class="row"><span class="ico">' + s.n + '</span><span class="body"><div class="title">'
          + esc(s.title || s.url) + '</div><div class="sub">' + esc(s.url) + '</div></span></div>'; }).join('')
        + '</div>' : '') +
      '<div class="section-title">Replay</div><div class="list">' + (d.actions.length ? d.actions.map(step).join('')
        : '<p class="small muted">No steps were logged.</p>') + '</div>' +
      '<button class="btn ghost block" type="button" data-close style="margin-top:12px">Close</button>');
  }).catch(function (e) { C.toast(e.message, 'bad'); });
}

export { browser };
