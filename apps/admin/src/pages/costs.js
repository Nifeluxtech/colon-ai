/* Colon Admin · Costs (v0.14.0, Blueprint A6): AI spend and tokens per UTC day, model, plan and member, and today's
   spend against the daily alert (BILLING_DAILY_SPEND_CAP_MINOR, warn at 80 %, over at 100 %). Display only: the
   alert never blocks a reply. Spend is 0 until model prices are set in AI_MODEL_COSTS; tokens are always counted. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { spend, tokens } from '../components/billing.js';
import { chips, fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

var PLAN = { guest: 'Guests', none: 'Staff / no plan' };

function capBanner(cap) {
  if (cap.level === 'off') return '<div class="banner info">' + icon('info') + '<span>No daily spend alert set. '
    + 'Set BILLING_DAILY_SPEND_CAP_MINOR (kobo) on the server to get one.</span></div>';
  var text = 'Today ' + spend(cap.spend_minor) + ' of ' + spend(cap.cap_minor) + ' (' + cap.pct + '%).';
  if (cap.level === 'over') return '<div class="banner bad" role="alert">' + icon('alert') + '<span><b>Daily spend '
    + 'alert passed.</b> ' + text + ' Nothing is blocked; check the models below.</span></div>';
  if (cap.level === 'warn') return '<div class="banner" role="alert">' + icon('alert') + '<span><b>Over 80% of the '
    + 'daily spend alert.</b> ' + text + '</span></div>';
  return '<div class="banner info">' + icon('check') + '<span>' + text + ' Under the daily alert.</span></div>';
}

// One bar per day: spend when any model is priced, else tokens.
function bars(byDay, priced) {
  var val = function (d) { return priced ? d.cost_minor : d.input_tokens + d.output_tokens; };
  var max = Math.max.apply(null, byDay.map(val).concat([0]));
  if (!max) return '<div class="empty small">No AI calls in this period.</div>';
  return byDay.slice().reverse().map(function (d) {
    var pct = Math.round(val(d) / max * 100);
    return '<div class="adm-rrow"><span class="tiny muted" style="width:78px;flex:none">' + esc(d.day.slice(5))
      + '</span><span class="body"><div class="progress"><i style="width:' + pct + '%"></i></div></span>'
      + '<b class="tiny" style="flex:none;min-width:72px;text-align:right">' + (priced ? spend(d.cost_minor)
      : tokens(val(d))) + '</b></div>';
  }).join('');
}

function table(cols, rows) {
  if (!rows.length) return '<div class="empty small">Nothing yet.</div>';
  return '<div class="card adm-table-wrap"><table class="adm-table"><thead><tr>' + cols.map(function (c) {
    return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
    return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('')
    + '</tbody></table></div>';
}
var nums = function (x) { return [num(x.calls), tokens(x.input_tokens), tokens(x.output_tokens), spend(x.cost_minor)];
};

/* ================= Costs ================= */
function costs(view) {
  gate(view, function () {
    var days = '7';
    view.innerHTML = head('Costs', 'AI spend and tokens, from every provider call. Days are UTC; calls are kept '
      + '30 days.') + chips([['1', 'Today'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']], days, 'data-d')
      + '<div id="co" style="margin-top:12px"></div>';
    function load() {
      $('#co', view).innerHTML = skel(5);
      C.api('/admin/billing/costs?days=' + days).then(function (d) {
        var t = d.totals, td = d.today, stat = function (v, l) { return '<div class="stat"><b>' + v + '</b><span>'
          + esc(l) + '</span></div>'; };
        $('#co', view).innerHTML = capBanner(td.cap) + (d.priced ? '' : '<p class="small muted">No model prices '
          + 'are set (AI_MODEL_COSTS), so spend shows ₦0 and the chart shows tokens. Free tiers cost nothing.</p>')
          + '<div class="grid cols-4">' + stat(spend(td.cost_minor), 'Spend today') + stat(spend(t.cost_minor),
            'Spend · ' + d.days + ' days') + stat(tokens(t.input_tokens + t.output_tokens), 'Tokens · ' + d.days
            + ' days') + stat(num(t.calls), 'Provider calls') + '</div>'
          + '<div class="section-title">' + (d.priced ? 'Spend' : 'Tokens') + ' per day</div><div class="card">'
          + bars(d.byDay, d.priced) + '</div>'
          + '<div class="section-title">Per model</div>' + table(['Model', 'Calls', 'In', 'Out', 'Spend'],
            d.byModel.map(function (m) { return ['<b>' + esc(m.model) + '</b><div class="tiny muted">'
              + esc(m.provider) + '</div>'].concat(nums(m)); }))
          + '<div class="section-title">Per plan</div>' + table(['Plan', 'Calls', 'In', 'Out', 'Spend'],
            d.byPlan.map(function (p) { return [esc(PLAN[p.plan] || p.plan)].concat(nums(p)); }))
          + '<div class="section-title">Top members</div>' + table(['Member', 'Calls', 'In', 'Out', 'Spend'],
            d.topUsers.map(function (u) { return ['<a href="#/credits?user=' + u.user_id + '">' + esc(u.email
              || 'User ' + u.user_id) + '</a>'].concat(nums(u)); }));
      }).catch(function (e) { fail($('#co', view), e); });
    }
    $$('[data-d]', view).forEach(function (b) { b.addEventListener('click', function () {
      days = b.getAttribute('data-d');
      $$('[data-d]', view).forEach(function (x) { x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b); });
      load(); }); });
    load();
  });
}

export { costs };
