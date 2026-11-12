/* Colon Admin · Models and providers: provider list, model list, availability. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { act } from '../components/form.js';
import { fail, head, skel } from '../components/page.js';
import { modelSheet, providerSheet } from '../components/provider-sheet.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Models and providers ================= */
function models(view) {
  gate(view, function () {
    view.innerHTML = head('Models and providers', 'Changes reach every server within about 30 seconds.')
      + '<div id="pv">' + skel(3) + '</div><div id="md"></div>';
    function load() {
      Promise.all([C.api('/admin/providers'), C.api('/admin/models')]).then(function (res) {
        var p = res[0], m = res[1];
        $('#pv', view).innerHTML =
          '<div class="adm-sec"><div class="section-title">Providers</div><button class="btn sm" data-addp>' + icon(
          'plus') + 'Add</button></div><div class="list">' + p.providers.map(function (x) {
          return '<button class="row" data-p="' + esc(x.id) + '"><span class="ico">' + (x.live
            ? '<span class="status-dot"></span>' : '<span class="status-dot ' + (x.enabled ? 'warn' : 'bad')
            + '"></span>') + '</span><span class="body"><div class="title">' + esc(x.name)
            + ' <span class="tiny muted">' + esc(x.id) + '</span></div>' +
            '<div class="sub">' + esc(x.base_url || 'No base URL') + '</div><div class="adm-badges">' + (x.live
              ? '<span class="badge ok">Live</span>' : x.enabled ? '<span class="badge warn">Not ready</span>' :
              '<span class="badge bad">Off</span>') +
            '<span class="badge">' + (x.key.source === 'database' ? 'Key ' + esc(x.key.masked) :
              x.key.source === 'environment' ? 'Key from server env' : 'No key') + '</span>' + (x.builtin
              ? '' : '<span class="badge cyan">Custom</span>') + '</div></span><span class="chev">' + icon('chev')
              + '</span></button>';
        }).join('') + '</div>';
        var groups = {};
        m.models.forEach(function (x) { (groups[x.target] = groups[x.target] || []).push(x); });
        $('#md', view).innerHTML =
          '<div class="adm-sec"><div class="section-title">Models by slot</div><button class="btn sm" data-addm>'
          + icon('plus') + 'Add</button></div>' +
          (m.source === 'default' ? '<div class="banner info">' + icon('info')
            + ('<span>These are the built-in models from the server. Your first change copies them to the '
            + 'database.</span><button class="btn sm" data-seed>Copy now</button></div>') : '') +
          Object.keys(groups).map(function (t) {
            return '<div class="card adm-slot"><div class="adm-slot-h"><b>' + esc(t)
              + '</b><span class="tiny muted">tried top to bottom</span></div>' + groups[t].map(function (x) {
              return '<button class="adm-model" data-m="' + (x.id || '') + '"' + (x.id ? '' : ' disabled')
                + '><span class="status-dot' + (x.enabled ? '' : ' bad') + '"></span><span class="body"><b>'
                + esc(x.model) + '</b><span class="tiny muted"> · ' + esc(x.provider_id) + (x.vision
                ? ' · images' : '') + (x.enabled ? '' : ' · off') + '</span></span>' + (x.id ? icon('edit') : '')
                + '</button>';
            }).join('') + '</div>';
          }).join('');
        $$('[data-p]', view).forEach(function (b) { b.addEventListener('click', function () { providerSheet(
          p.providers.filter(function (x) { return x.id === b.getAttribute('data-p'); })[0], p.can_edit_keys, load);
          }); });
        $('[data-addp]', view).addEventListener('click', function () { providerSheet(null, p.can_edit_keys, load); });
        $('[data-addm]', view).addEventListener('click', function () { modelSheet(null, m.providers, load); });
        $$('[data-m]', view).forEach(function (b) { if (b.getAttribute('data-m')) b.addEventListener('click',
          function () { modelSheet(m.models.filter(function (x) { return String(x.id) === b.getAttribute('data-m');
          })[0], m.providers, load); }); });
        var seed = $('[data-seed]', view);
        if (seed) seed.addEventListener('click', function () { seed.disabled = true; act(C.api('/admin/models/seed',
          { method: 'POST' }), function () { C.toast('Models copied to the database.', 'ok'); load();
          }).catch(function () { seed.disabled = false; }); });
      }).catch(function (e) { fail($('#pv', view), e); });
    }
    load();
  });
}

export { models };
