/* Colon Admin · System settings: branding, feature flags, maintenance mode and the announcement banner. */

import { webSearch } from './web-search.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { area, sel, sw } from '../components/form.js';
import { fail, head, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, $ = C.$, $$ = C.$$;

/* ================= System settings (Super Admin) ================= */
function system(view) {
  gate(view, function () {
    view.innerHTML = head('System settings',
      'Branding, feature flags, maintenance mode and the announcement banner. Live within 30 s.') + '<div id="sy">'
      + skel(4) + '</div>';
    C.api('/admin/system').then(function (d) {
      var S = d.system;
      $('#sy', view).innerHTML = '<form novalidate class="adm-stack">' +
        '<div class="card form"><div class="h3">Branding</div>' + C.field({ name: 'brandName', label: 'Product name',
          value: S.brandName }) + '</div>' +
        '<div class="card"><div class="h3">Feature flags</div><div class="list">' + Object.keys(d.features).map(
          function (k) { return sw('f_' + k, d.features[k], '', S.features[k] !== false);
          }).join('') + '</div><p class="tiny muted">Staff are never blocked by a flag.</p></div>' +
        '<div class="card form"><div class="h3">Maintenance mode</div><div class="list">' + sw('m_on',
          'Maintenance on', 'New chat messages get this message instead of a reply. Staff can still chat.',
          S.maintenance.on) + '</div>' + area('m_message', 'Message', S.maintenance.message) + '</div>' +
        '<div class="card form"><div class="h3">Announcement banner</div><div class="list">' + sw('a_on',
          'Show banner in Colon AI', '', S.announcement.on) + '</div>' + area('a_text', 'Text', S.announcement.text,
          'e.g. New: Study mode now explains step by step.') +
        sel('a_tone', 'Style', S.announcement.tone, [['info', 'Info'], ['warn', 'Warning']]) + '</div>' +
        '<button class="btn primary block" type="submit">Save system settings</button></form>';
      C.bindForm($('form', view), function (f) {
        var features = {}; Object.keys(d.features).forEach(function (k) { features[k] = f['f_' + k]; });
        return C.api('/admin/system', { method: 'PATCH', body: { brandName: f.brandName, features: features,
          maintenance: { on: f.m_on, message: f.m_message }, announcement: { on: f.a_on, text: f.a_text,
          tone: f.a_tone } } })
          .then(function () { C.toast('Saved. Live within 30 seconds.', 'ok'); });
      });
    }).catch(function (e) { fail($('#sy', view), e); });
    view.insertAdjacentHTML('beforeend', '<div id="ws" class="adm-stack" style="margin-top:16px">' + skel(3)
      + '</div>');
    webSearch($('#ws', view));
  });
}

export { system };
