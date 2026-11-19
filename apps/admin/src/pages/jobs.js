/* Colon Admin · Jobs (v0.16.0, Blueprint C13): background jobs and the cron dispatcher. Counts by status and type,
   stale leases (a runner stopped mid-job), the dead-letter list, recent jobs, the cron's last runs with a warning when
   the last one is older than 3 × the interval, and retry / cancel with a reason (kept in the audit log). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { chips, fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

var FILTERS = [['', 'All'], ['queued', 'Queued'], ['running', 'Running'], ['failed', 'Retrying'], ['dead', 'Dead'],
  ['stale', 'Stale'], ['done', 'Done'], ['cancelled', 'Cancelled']];
var BADGE = { queued: '', running: ' cyan', done: ' ok', failed: ' warn', dead: ' bad', cancelled: '' };

function badge(j) {
  var s = j.stale ? 'stale' : j.status;
  return '<span class="badge' + (j.stale ? ' bad' : BADGE[j.status] || '') + '">' + esc(s) + '</span>';
}
function mins(ms) { return ms == null ? '—' : ms < 90e3 ? Math.round(ms / 1000) + ' s' : Math.round(ms / 60e3)
  + ' min'; }

function cronBanner(c, s) {
  var how = ' Add the cron job from the deploy runbook (Release notes 0.16.0).';
  if (c.level === 'never') return '<div class="banner bad" role="alert">' + icon('alert') + '<span><b>The cron has '
    + 'never run.</b> Background jobs wait until it does' + (s.inprocess ? ' (the in-process fallback is on).' : '.')
    + how + '</span></div>';
  var line = 'Last run ' + C.ago(c.last.started_at) + ' (' + esc(c.last.runner) + ', ' + mins(c.last.duration_ms)
    + ', ' + num(c.last.done) + ' done' + (c.last.failed ? ', ' + num(c.last.failed) + ' failed' : '')
    + (c.last.dead ? ', ' + num(c.last.dead) + ' dead' : '') + ').' + (c.last.error ? ' Error: ' + esc(c.last.error)
    : '');
  if (c.warn) return '<div class="banner" role="alert">' + icon('alert') + '<span><b>The cron looks stopped.</b> '
    + line + ' That is more than 3 × the ' + num(c.interval_min) + '-minute interval.' + how + '</span></div>';
  return '<div class="banner info">' + icon('check') + '<span>' + line + ' Runs every ' + num(c.interval_min)
    + ' minutes.</span></div>';
}

function jobRow(j) {
  var acts = (['dead', 'failed', 'cancelled'].indexOf(j.status) > -1 ? '<button class="btn sm" type="button" '
    + 'data-act="retry" data-id="' + j.id + '">Retry</button>' : '')
    + (['queued', 'failed', 'running'].indexOf(j.status) > -1 ? '<button class="btn ghost sm" type="button" '
    + 'data-act="cancel" data-id="' + j.id + '">Cancel</button>' : '');
  return '<div class="row"><span class="body"><div class="title">#' + j.id + ' · ' + esc(j.type) + ' ' + badge(j)
    + '</div><div class="sub">' + (j.user_id ? 'user ' + j.user_id + ' · ' : '') + 'try ' + j.attempts + '/'
    + j.max_attempts + ' · ' + (j.status === 'queued' || j.status === 'failed' ? 'due ' : 'run at ')
    + esc(new Date(j.run_at).toLocaleString()) + (j.ref ? ' · ' + esc(j.ref) : '') + '</div>'
    + (j.last_error ? '<div class="tiny muted">' + esc(j.last_error) + '</div>' : '') + '</span>'
    + '<span style="display:flex;gap:6px;flex:none">' + acts + '</span></div>';
}
function list(rows, empty) { return rows.length ? '<div class="list">' + rows.map(jobRow).join('') + '</div>'
  : '<div class="empty small">' + esc(empty) + '</div>'; }

function act(kind, id, done) {
  var verb = kind === 'retry' ? 'Retry' : 'Cancel';
  C.sheet('<div class="h2">' + verb + ' job #' + id + '</div><p class="small muted">' + (kind === 'retry'
    ? 'It runs again at the next cron run, with its attempts reset.' : 'It will not run. A running job finishes '
    + 'its current step, but its result is ignored.') + '</p><form class="form" novalidate>' + C.field({ name: 'reason',
    label: 'Reason (kept in the audit log)', max: 300 }) + '<button class="btn primary block" type="submit">' + verb
    + '</button><button class="btn ghost block" type="button" data-close>Back</button></form>', function (el, close) {
    C.bindForm($('form', el), function (f) {
      return C.confirm({ title: verb + ' job #' + id + '?', body: 'Reason: ' + f.reason, confirm: verb,
        danger: kind === 'cancel' }).then(function (ok) {
        if (!ok) return;
        return C.api('/admin/jobs/' + id + '/' + kind, { method: 'POST', body: { reason: f.reason } })
          .then(function (r) { C.toast('Job #' + id + ' ' + r.job.status + '.', 'ok'); close(); done(); });
      });
    });
  });
}

/* ================= Jobs ================= */
function jobsPage(view) {
  gate(view, function () {
    var status = '', type = '';
    view.innerHTML = head('Jobs', 'Background work in the job table, run by the cron dispatcher (and Saga schedules '
      + 'by the worker holding the phone).') + '<div id="jb">' + skel(5) + '</div>';
    function load() {
      C.api('/admin/jobs?status=' + status + '&type=' + encodeURIComponent(type)).then(function (d) {
        var n = d.counts, stat = function (v, l) { return '<div class="stat"><b>' + num(v) + '</b><span>' + esc(l)
          + '</span></div>'; };
        var types = '<select class="input sm" data-type aria-label="Job type"><option value="">Every type</option>'
          + d.known_types.map(function (t) { return '<option value="' + esc(t.type) + '"' + (t.type === type
            ? ' selected' : '') + '>' + esc(t.type) + '</option>'; }).join('') + '</select>';
        $('#jb', view).innerHTML = cronBanner(d.cron, d.settings)
          + '<div class="grid cols-4">' + stat(n.queued, 'Queued') + stat(n.running, 'Running') + stat(n.failed,
            'Retrying') + stat(n.dead, 'Dead') + '</div>'
          + (d.stale ? '<div class="banner" style="margin-top:12px">' + icon('alert') + '<span>' + num(d.stale)
            + ' running job' + (d.stale === 1 ? '' : 's') + ' with an expired lease: the runner stopped. The next '
            + 'run takes ' + (d.stale === 1 ? 'it' : 'them') + ' over.</span></div>' : '')
          + '<div class="section-title">Dead letters</div>' + list(d.dead, 'No dead jobs.')
          + '<div class="section-title">Jobs</div>' + chips(FILTERS, status, 'data-st')
          + '<div style="margin:10px 0">' + types + '</div>' + list(d.jobs, 'No jobs here.')
          + '<div class="section-title">By type</div><div class="list">' + d.types.map(function (t) {
            return '<div class="row"><span class="body"><div class="title">' + esc(t.type) + '</div><div class="sub">'
              + ['queued', 'running', 'failed', 'dead', 'done', 'cancelled'].filter(function (s) { return t[s]; })
                .map(function (s) { return num(t[s]) + ' ' + s; }).join(' · ') + '</div></span></div>';
          }).join('') + '</div>'
          + '<div class="section-title">Recent cron runs</div><div class="list">' + (d.runs.length ? d.runs.map(
            function (r) { return '<div class="row"><span class="body"><div class="title">' + esc(r.runner) + ' · '
              + mins(r.duration_ms) + ' · ' + num(r.claimed) + ' claimed, ' + num(r.done) + ' done</div>'
              + (r.error ? '<div class="sub">' + esc(r.error) + '</div>' : '') + '</span><span class="tiny muted">'
              + C.ago(r.started_at) + '</span></div>'; }).join('') : '<div class="empty small">None yet.</div>')
          + '</div><p class="tiny muted">Batch ' + num(d.settings.batch_size) + ' · time limit '
          + mins(d.settings.time_limit_ms) + ' · lease ' + mins(d.settings.lease_ms) + ' · ' + num(
            d.settings.max_attempts) + ' tries · in-process fallback ' + (d.settings.inprocess ? 'on' : 'off')
          + ' · HTTP trigger ' + (d.settings.http_trigger ? 'on' : 'off') + '</p>';
        $$('[data-st]', view).forEach(function (b) { b.addEventListener('click', function () {
          status = b.getAttribute('data-st'); load(); }); });
        $('[data-type]', view).addEventListener('change', function (e) { type = e.target.value; load(); });
        $$('[data-act]', view).forEach(function (b) { b.addEventListener('click', function () {
          act(b.getAttribute('data-act'), b.getAttribute('data-id'), load); }); });
      }).catch(function (e) { fail($('#jb', view), e); });
    }
    load();
  });
}

export { jobsPage };
