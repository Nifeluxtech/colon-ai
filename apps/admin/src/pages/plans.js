/* Colon Admin · Plans (v0.14.0, Blueprint A7): prices (typed in naira, stored in kobo), order, on/off and monthly
   allowances per plan. Every save needs a reason (audit log). The Free plan always costs ₦0 and stays on. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { FEATURES, naira, toKobo } from '../components/billing.js';
import { opt, sw } from '../components/form.js';
import { fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

function allowance(e) { return !e || !e.enabled ? 'Off' : e.limit == null ? 'No cap' : num(e.limit); }

/* ================= Plans ================= */
function plans(view) {
  gate(view, function () {
    view.innerHTML = head('Plans', 'Prices and monthly allowances. Changes reach every server within a minute; '
      + 'people keep what they already paid for.') + '<div id="pl">' + skel(4) + '</div>';
    var features = Object.keys(FEATURES);
    function load() {
      C.api('/admin/billing/plans').then(function (d) {
        features = d.features || features;
        if (!d.plans.length) { $('#pl', view).innerHTML = '<div class="card empty">' + icon('list')
          + '<p>No plans yet. They are created by the database migration.</p></div>'; return; }
        $('#pl', view).innerHTML = '<div class="list">' + d.plans.map(function (p) {
          var credits = p.entitlements.ai_credits;
          return '<button type="button" class="row" data-plan="' + esc(p.code) + '"><span class="ico">' + icon(
            'tabs') + '</span><span class="body"><div class="title">' + esc(p.name) + (p.active ? ''
            : ' <span class="badge warn">Off</span>') + '</div><div class="sub">' + esc(p.code) + ' · '
            + allowance(credits) + ' credits a month</div></span><b>' + (Number(p.price_minor) ? naira(p.price_minor)
            : 'Free') + '</b>' + icon('chev') + '</button>';
        }).join('') + '</div><p class="tiny muted" style="margin-top:10px">Prices are per 30 days, in naira. '
          + 'Paying users are charged the price shown at checkout.</p>';
        $$('[data-plan]', view).forEach(function (b) { b.addEventListener('click', function () {
          edit(d.plans.filter(function (p) { return p.code === b.getAttribute('data-plan'); })[0]); }); });
      }).catch(function (e) { fail($('#pl', view), e); });
    }
    function edit(p) {
      var free = p.code === 'free';
      C.sheet('<div class="h2">' + esc(p.name) + ' plan</div><p class="small muted">Code ' + esc(p.code)
        + (free ? ' · always free and always on' : '') + '</p><form class="form" novalidate>' +
        C.field({ name: 'name', label: 'Name', value: p.name, max: 60 }) +
        (free ? '' : C.field({ name: 'price', label: 'Price per 30 days (₦)', type: 'number', mode: 'decimal',
          value: String(Number(p.price_minor) / 100) })) +
        opt('sort', 'Order on the plan page', p.sort, '0', 'number') +
        (free ? '' : sw('active', 'On sale', 'Off hides it from the plan page; current subscribers keep it',
          p.active)) +
        '<div class="h3" style="margin-top:8px">Monthly allowances</div><p class="small muted">Empty = no cap. '
          + 'Switch off to remove the feature from this plan.</p>' +
        features.map(function (f) {
          var e = p.entitlements[f] || { enabled: false, limit: null };
          return sw('on_' + f, FEATURES[f] || f, 'Now: ' + allowance(p.entitlements[f]), e.enabled)
            + opt('lim_' + f, (FEATURES[f] || f) + ' (number)', e.limit, 'No cap', 'number');
        }).join('') +
        C.field({ name: 'reason', label: 'Reason for this change (kept in the audit log)', max: 300 }) +
        '<button class="btn primary block" type="submit">Save plan</button>'
        + '<button class="btn ghost block" type="button" data-close>Close</button></form>', function (el, close) {
        C.bindForm($('form', el), function (f) {
          var body = { name: f.name, sort: f.sort === '' ? 0 : Number(f.sort), reason: f.reason, entitlements: {} };
          if (!free) {
            body.price_minor = toKobo(f.price);
            if (!(body.price_minor >= 0)) throw Object.assign(new Error('Enter a price in naira, e.g. 7000.'),
              { field: 'price' });
            body.active = f.active;
          }
          features.forEach(function (k) { body.entitlements[k] = { enabled: f['on_' + k], limit: f['lim_' + k] === ''
            ? null : Number(f['lim_' + k]) }; });
          return C.confirm({ title: 'Save the ' + p.name + ' plan?', body: free ? 'Allowances change for everyone '
            + 'on Free.' : 'New price ' + naira(body.price_minor) + '. Allowances change for everyone on this plan.',
            confirm: 'Save' }).then(function (ok) {
            if (!ok) return;
            return C.api('/admin/billing/plans/' + encodeURIComponent(p.code), { method: 'PATCH', body: body })
              .then(function () { C.toast('Plan saved.', 'ok'); close(); load(); });
          });
        });
      });
    }
    load();
  });
}

export { plans };
