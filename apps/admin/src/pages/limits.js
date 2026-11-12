/* Colon Admin · Usage limits for guests, members and per user. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { opt } from '../components/form.js';
import { fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';
import { MODE_LABELS } from '../core/state.js';

var C = Colon, $ = C.$, $$ = C.$$;

/* ================= Usage and limits ================= */
function limitsPage(view) {
  gate(view, function () {
    view.innerHTML = head('Usage and limits',
      'Daily reply limits, live on every server within 30 s. Days reset at midnight UTC.') + '<div id="lm">' + skel(4)
      + '</div>';
    C.api('/admin/limits').then(function (d) {
      var L = d.limits, t = d.today;
      var tStat = function (k, l) { var x = t[k] || { subjects: 0, requests: 0 }; return '<div class="stat"><b>'
        + num(x.requests) + '</b><span>' + l + ' · ' + num(x.subjects) + ' active</span></div>'; };
      $('#lm', view).innerHTML = '<div class="section-title">Today</div><div class="grid cols-4">' + tStat('users',
        'Member replies') + tStat('guests', 'Guest replies') + '</div>' +
        '<form class="card form" novalidate style="margin-top:14px"><div class="h3">Daily limits</div>' +
        C.field({ name: 'user', label: 'Members (replies per day, default ' + d.defaults.user + ')', type: 'number',
          value: L.user }) +
        C.field({ name: 'guest', label: 'Guests per browser (default ' + d.defaults.guest + ')', type: 'number',
          value: L.guest }) +
        C.field({ name: 'guestIp', label: 'All guests on one network/IP (default ' + d.defaults.guestIp + ')',
          type: 'number', value: L.guestIp }) +
        ('<div class="h3" style="margin-top:8px">Per mode (optional)</div><p class="small muted">Extra cap per '
          + 'person per mode. Empty = no cap. Staff are exempt.</p>') +
        Object.keys(MODE_LABELS).map(function (m) { return opt('mode_' + m, MODE_LABELS[m], L.modes[m], 'No cap',
          'number'); }).join('') +
        '<button class="btn primary block" type="submit">Save limits</button></form>' +
        '<div class="section-title">Per-user overrides</div><div class="list">' + (d.overrides.length ? d.overrides.map(
          function (o) {
          return C.row('#/users/' + o.user_id, 'user', (o.name || o.email) + ' · ' + num(o.daily_limit) + '/day',
            o.email);
        }).join('') : '<div class="empty small">None. Set one from a user’s page.</div>') + '</div>';
      C.bindForm($('form', view), function (f) {
        var modes = {}; Object.keys(MODE_LABELS).forEach(function (m) { modes[m] = f['mode_' + m] === ''
          ? null : Number(f['mode_' + m]); });
        return C.api('/admin/limits', { method: 'PATCH', body: { user: Number(f.user), guest: Number(f.guest),
          guestIp: Number(f.guestIp), modes: modes } }).then(function () { C.toast('Limits saved.', 'ok'); });
      });
    }).catch(function (e) { fail($('#lm', view), e); });
  });
}

export { limitsPage };
