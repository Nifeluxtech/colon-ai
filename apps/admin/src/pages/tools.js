/* Colon Admin · Tools (v0.17.0, Blueprint D14): the server-side tool registry, read-only. Each tool's risk, plan
   access, credit cost, timeout, consent step and on/off state (e.g. image generation is off while IMAGE_MODEL is
   empty). The policy lives in code (services/api/src/modules/tools/catalogue.js); plan allowances are edited in
   Admin › Plans. Call counts are the answering API worker's since it started. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { chips, fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';
import { imageProviderText, summary, toolView } from '../lib/tools-view.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

var FILTERS = [['', 'All'], ['on', 'On'], ['off', 'Off'], ['high', 'High risk']];

function toolRow(t) {
  var v = toolView(t);
  var line = function (k, val) { return '<div class="sub"><b>' + esc(k) + ':</b> ' + esc(val) + '</div>'; };
  return '<div class="row" data-tool="' + esc(v.name) + '"><span class="body"><div class="title">' + esc(v.name)
    + ' <span class="badge' + v.riskClass + '">' + esc(v.risk) + ' risk</span> <span class="badge' + v.stateClass
    + '">' + esc(v.state) + '</span>' + v.flags.map(function (f) { return ' <span class="badge">' + esc(f)
      + '</span>'; }).join('') + '</div>'
    + (v.description ? '<div class="sub">' + esc(v.description) + '</div>' : '')
    + (v.off ? '<div class="sub" style="color:var(--warn)">' + esc(v.off) + '</div>' : '')
    + line('Access', v.plans) + line('Cost', v.credits) + line('Timeout', v.timeout) + line('Consent', v.consent)
    + (v.note ? '<div class="tiny muted">' + esc(v.note) + '</div>' : '')
    + '<div class="tiny muted">' + esc(v.stats) + '</div></span></div>';
}

function pick(tools, filter) {
  return tools.filter(function (t) {
    return !filter || (filter === 'on' ? t.enabled : filter === 'off' ? !t.enabled : t.risk === 'high');
  });
}

/* ================= Tools ================= */
function toolsPage(view) {
  gate(view, function () {
    var filter = '', data = null;
    view.innerHTML = head('Tools', 'Server-side tools the chat and background jobs can call, with the policy each '
      + 'call runs under. Read-only: the policy is set in code, allowances in Plans.') + '<div id="tl">' + skel(5)
      + '</div>';
    function render() {
      var tools = data.tools || [], n = summary(tools), shown = pick(tools, filter);
      var stat = function (v, l) { return '<div class="stat"><b>' + num(v) + '</b><span>' + esc(l)
        + '</span></div>'; };
      $('#tl', view).innerHTML = '<div class="banner info">' + icon('info') + '<span>Billing mode: <b>'
        + esc(data.billing_mode || 'unknown') + '</b>. Call counts are this API worker\'s since it started.'
        + (data.image ? ' ' + esc(imageProviderText(data.image)) : '') + '</span></div>'
        + '<div class="grid cols-4" style="margin-top:12px">' + stat(n.total, 'Tools') + stat(n.on, 'On')
        + stat(n.off, 'Off') + stat(n.high, 'High risk') + '</div>'
        + '<div class="section-title">Registry</div>' + chips(FILTERS, filter, 'data-tf')
        + (shown.length ? '<div class="list" style="margin-top:10px">' + shown.map(toolRow).join('') + '</div>'
          : '<div class="empty small">No tools here.</div>');
      $$('[data-tf]', view).forEach(function (b) { b.addEventListener('click', function () {
        filter = b.getAttribute('data-tf'); render(); }); });
    }
    C.api('/admin/tools').then(function (d) { data = d || {}; render(); })
      .catch(function (e) { fail($('#tl', view), e); });
  });
}

export { pick, toolsPage };
