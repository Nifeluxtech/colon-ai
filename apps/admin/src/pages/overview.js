/* Colon Admin · Overview: users, chat volume, reply times, reports and routing at a glance. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { dot, fail, num } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Overview ================= */
function overview(view) {
  gate(view, function () {
    var u = C.user, hi = '<h1 class="h1">Hello, ' + esc((u.name || '').split(' ')[0] || 'admin')
      + '</h1><p class="lead">' + C.roleName(u.role) + ' · Colon control centre</p>';
    if (!C.hasRole('admin')) {
      view.innerHTML = hi + '<div class="list">' + C.row('#/moderation', 'hand', 'Moderation queue',
        'Reported conversations and bad feedback') + C.row('#/users', 'users', 'Users',
        'Search and view accounts (read-only)') + '</div>';
      return;
    }
    view.innerHTML = hi + '<div id="ov">' + '<div class="grid cols-4">' + [1, 2, 3, 4].map(function () { return (
      '<div class="stat"><div class="skel" style="height:30px;width:60%"></div><div class="skel" '
      + 'style="height:12px;margin-top:8px"></div></div>'); }).join('') + '</div></div>';
    C.api('/admin/overview').then(function (d) {
      var stat = function (v, l, cls) { return '<div class="stat' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>'
        + esc(l) + '</span></div>'; };
      var rq = d.requests, failPct = rq.day ? Math.round(rq.failed_day / rq.day * 100) : 0;
      $('#ov', view).innerHTML =
        '<div class="section-title">Users</div><div class="grid cols-4">' + stat(num(d.users.users), 'Users') + stat(
          num(d.users.active_7d), 'Active 7 days') + stat(num(d.users.new_24h), 'New today') + stat(num(
          d.users.suspended), 'Suspended') + '</div>' +
        '<div class="section-title">Chat (last 24 hours)</div><div class="grid cols-4">' + stat(num(rq.day),
          'Requests') + stat(num(rq.failed_day) + (rq.day ? ' <small>(' + failPct + '%)</small>' : ''), 'Failed') +
          stat(d.latency.avg_ms ? (d.latency.avg_ms / 1000).toFixed(1) + ' s' : '—', 'Avg reply time') + stat(num(
            d.moderation_open), 'Open reports') + '</div>' +
        '<p class="tiny muted">' + num(rq.week) + ' requests in 7 days · ' + num(rq.guest_day)
          + ' from guests today · routing from ' + esc(d.routing_source) + '</p>' +
        '<div class="section-title">Provider health</div><div class="list">' + (d.providers.length ? d.providers.map(
          function (p) {
          return '<div class="row"><span class="ico">' + dot(p.success)
            + '</span><span class="body"><div class="title">' + esc(p.provider) + (p.enabled
            ? '' : ' <span class="badge warn">Off now</span>') + '</div><div class="sub">' + num(p.attempts)
            + ' calls · ' + (p.avg_ms ? (p.avg_ms / 1000).toFixed(1) + ' s avg' : 'no successes') + (p.last_error
            ? ' · last error ' + esc(p.last_error) : '') + '</div></span><b>' + (p.success == null ? '—' : p.success
            + '%') + '</b></div>';
        }).join('') : '<div class="empty small">No AI calls in the last 24 hours. Enabled now: '
          + esc(d.enabled_providers.join(', ') || 'none') + '</div>') + '</div>' +
        (d.models.length ? ('<div class="section-title">Models (24 h)</div><div class="card adm-table-wrap"><table '
          + 'class="adm-table"><thead><tr><th>Model</th><th>Calls</th><th>OK</th><th>Avg</th></tr></thead><tbody>')
          + d.models.map(function (m) {
          return '<tr><td><b>' + esc(m.model) + '</b><div class="tiny muted">' + esc(m.provider) + '</div></td><td>'
            + num(m.attempts) + '</td><td>' + (m.success == null ? '—' : m.success + '%') + '</td><td>' + (m.avg_ms
            ? (m.avg_ms / 1000).toFixed(1) + ' s' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '') +
        (d.errors.length ? '<div class="section-title">Errors (24 h)</div><div class="chips">' + d.errors.map(function (
          e) { return '<span class="badge warn">' + esc(e.code) + ' · ' + num(e.n) + '</span>';
          }).join('') + '</div>' : '') +
        '<div class="section-title">Manage</div><div class="list">' + C.row('#/models', 'bot', 'Models and providers',
          'Add models, keys, enable or disable') + C.row('#/routing', 'lightning', 'Routing',
          'Model order per mode, live') + C.row('#/limits', 'target', 'Usage and limits', 'Daily quotas') + '</div>';
    }).catch(function (e) { fail($('#ov', view), e); });
  });
}

export { overview };
