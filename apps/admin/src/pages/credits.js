/* Colon Admin · Credits and payments (v0.14.0, Blueprint A7).
   Credits: find a member by email or id, see their plan, balance and ledger, grant or revoke credits and set or comp
   a plan. Every change asks for a reason and a confirmation; each dialog sends one key, so a retry is applied once.
   Payments: recent Korapay payments, filtered by status. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { naira, newKey, payBadge } from '../components/billing.js';
import { sel } from '../components/form.js';
import { chips, fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

var KIND = { grant: 'Granted', revoke: 'Revoked', usage: 'Used', settle: 'Adjusted', refund: 'Refunded',
  expire: 'Expired', promo: 'Promo', adjust: 'Adjusted' };

function day(d) { return d ? new Date(d).toLocaleDateString() : '—'; }

/* ================= Credits ================= */
function credits(view, ctx) {
  gate(view, function () {
    var q = ctx && ctx.query, tab = (q && q.get('tab')) === 'payments' ? 'payments' : 'credits';
    view.innerHTML = head('Credits', 'Balances, manual grants and plans for one member, and recent payments.') +
      chips([['credits', 'Member credits'], ['payments', 'Payments']], tab, 'data-tab') + '<div id="cr"></div>';
    $$('[data-tab]', view).forEach(function (b) { b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      $$('[data-tab]', view).forEach(function (x) { x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b); });
      show(); }); });
    function show() { if (tab === 'payments') payments($('#cr', view)); else member($('#cr', view), q && q.get('user'));
    }
    show();
  });
}

function member(box, initial) {
  box.innerHTML = '<form class="card adm-search" style="margin-top:12px" data-find>' + icon('search')
    + '<input class="input" name="who" type="search" autocomplete="off" placeholder="Member email or id" '
    + 'aria-label="Member email or id" value="' + esc(initial || '') + '"><button class="btn primary sm" '
    + 'type="submit">Find</button></form><div id="cm"></div>';
  var out = $('#cm', box);
  function open(who) {
    out.innerHTML = skel(4);
    return C.api('/admin/billing/users/' + encodeURIComponent(who)).then(function (d) { render(d, who); })
      .catch(function (e) { fail(out, e); });
  }
  function render(d, who) {
    var u = d.user, cr = d.credits, sub = d.subscription;
    var reload = function () { open(String(u.id)); };
    out.innerHTML = '<div class="card" style="margin-top:12px"><div class="h3">' + esc(u.name || u.email) + '</div>'
      + '<p class="small muted">' + esc(u.email) + ' · id ' + u.id + ' · ' + esc(C.roleName(u.role)) + '</p>'
      + (d.billable ? '' : '<p class="small"><span class="badge warn">Staff</span> Staff are never charged.</p>')
      + '<div class="grid cols-4" style="margin-top:10px"><div class="stat"><b>' + num(cr.balance) + '</b><span>'
      + 'Credits left · ' + esc(cr.period) + '</span></div><div class="stat"><b>' + num(cr.monthly) + '</b><span>'
      + 'Monthly on ' + esc(d.plan.name) + '</span></div><div class="stat"><b>' + esc(d.plan.name) + '</b><span>'
      + (sub && sub.status === 'active' && sub.period_end ? 'Until ' + day(sub.period_end) + (sub.provider === 'admin'
        ? ' · set by staff' : '') : 'No paid period') + '</span></div></div>'
      + '<div class="sheet-actions" style="margin-top:12px"><button class="btn" type="button" data-grant>' + icon(
        'plus') + ' Grant</button><button class="btn" type="button" data-revoke>Revoke</button><button class="btn '
      + 'primary" type="button" data-setplan>Set plan</button></div><p class="tiny muted">Billing mode: '
      + esc(d.mode) + '</p></div>'
      + '<div class="section-title">Ledger (latest first)</div><div class="list">' + (d.ledger.length
        ? d.ledger.map(function (e) {
          return '<div class="row"><span class="body"><div class="title">' + esc(KIND[e.kind] || e.kind) + ' '
            + (e.amount > 0 ? '+' : '') + num(e.amount) + '</div><div class="sub">' + esc(e.description || '')
            + ' · balance ' + num(e.balance_after) + '</div></span><span class="tiny muted">' + C.ago(e.created_at)
            + '</span></div>';
        }).join('') : '<div class="empty small">No ledger entries yet.</div>') + '</div>'
      + '<div class="section-title">Payments</div><div class="list">' + (d.payments.length ? d.payments.map(payRow)
        .join('') : '<div class="empty small">No payments.</div>') + '</div>';
    $('[data-grant]', out).addEventListener('click', function () { adjust(u, 1, reload); });
    $('[data-revoke]', out).addEventListener('click', function () { adjust(u, -1, reload); });
    $('[data-setplan]', out).addEventListener('click', function () { setPlan(u, d, reload); });
    if (who !== String(u.id)) history.replaceState(null, '', '#/credits?user=' + u.id);
  }
  $('[data-find]', box).addEventListener('submit', function (e) {
    e.preventDefault();
    var who = $('input', e.target).value.trim();
    if (!who) { C.toast('Enter an email or id.', 'bad'); return; }
    open(who);
  });
  if (initial) open(initial);
}

function adjust(u, sign, done) {
  var key = newKey(), verb = sign > 0 ? 'Grant' : 'Revoke';
  C.sheet('<div class="h2">' + verb + ' credits</div><p class="small muted">' + esc(u.email) + (sign > 0 ? ''
    : ' · a revoke never takes the balance below 0') + '</p><form class="form" novalidate>' + C.field({ name: 'amount',
    label: 'Credits', type: 'number', mode: 'numeric' }) + C.field({ name: 'reason',
    label: 'Reason (kept in the audit log)', max: 300 }) + '<button class="btn primary block" type="submit">' + verb
    + '</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>', function (el, close) {
    C.bindForm($('form', el), function (f) {
      var n = Math.abs(Math.round(Number(f.amount)));
      if (!n) throw Object.assign(new Error('Enter a whole number above 0.'), { field: 'amount' });
      return C.confirm({ title: verb + ' ' + num(n) + ' credits?', body: 'For ' + u.email + '. Reason: ' + f.reason,
        confirm: verb, danger: sign < 0 }).then(function (ok) {
        if (!ok) return;
        return C.api('/admin/billing/users/' + u.id + '/credits', { method: 'POST', body: { amount: sign * n,
          reason: f.reason, key: key } }).then(function (r) {
          C.toast((r.kind === 'grant' ? 'Granted ' : 'Revoked ') + num(Math.abs(r.amount)) + '. Balance '
            + num(r.balance) + '.', 'ok');
          close(); done();
        });
      });
    });
  });
}

function setPlan(u, d, done) {
  var key = newKey();
  C.api('/admin/billing/plans').then(function (pl) {
    var options = pl.plans.filter(function (p) { return p.active; }).map(function (p) { return [p.code, p.name
      + (Number(p.price_minor) ? ' · ' + naira(p.price_minor) : '')]; });
    C.sheet('<div class="h2">Set plan</div><p class="small muted">' + esc(u.email) + ' · now ' + esc(d.plan.name)
      + '. Upgrading tops this month’s credits up; Free ends any period.</p><form class="form" novalidate>'
      + sel('plan', 'Plan', d.plan.code, options) + C.field({ name: 'days', label: 'Days (ignored for Free)',
        type: 'number', value: '30', mode: 'numeric' }) + C.field({ name: 'reason',
        label: 'Reason (kept in the audit log)', max: 300 }) + '<button class="btn primary block" type="submit">'
      + 'Set plan</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>',
    function (el, close) {
      C.bindForm($('form', el), function (f) {
        var free = f.plan === 'free';
        return C.confirm({ title: 'Put ' + u.email + ' on ' + f.plan + '?', body: (free ? 'Any paid period ends now.'
          : 'For ' + f.days + ' days, free of charge.') + ' Reason: ' + f.reason, confirm: 'Set plan' })
          .then(function (ok) {
            if (!ok) return;
            return C.api('/admin/billing/users/' + u.id + '/plan', { method: 'POST', body: { plan: f.plan,
              days: free ? 0 : Number(f.days), reason: f.reason, key: key } }).then(function (r) {
              C.toast('Plan set' + (r.added ? ', +' + num(r.added) + ' credits' : '') + '.', 'ok'); close(); done();
            });
          });
      });
    });
  }).catch(function (e) { C.toast(e.message, 'bad'); });
}

function payRow(p) {
  return '<div class="row"><span class="body"><div class="title">' + naira(p.amount_minor) + ' · ' + esc(p.plan)
    + ' ' + payBadge(p.status) + '</div><div class="sub">' + (p.email ? '<a href="#/credits?user=' + p.user_id + '">'
    + esc(p.email) + '</a> · ' : '') + esc(p.reference) + (p.method ? ' · ' + esc(p.method) : '') + (p.failure
    ? ' · ' + esc(p.failure) : '') + '</div></span><span class="tiny muted">' + C.ago(p.paid_at || p.created_at)
    + '</span></div>';
}

/* ================= Payments ================= */
function payments(box) {
  var status = '';
  box.innerHTML = '<div style="margin-top:12px">' + chips([['', 'All'], ['success', 'Paid'], ['pending', 'Pending'],
    ['failed', 'Failed'], ['abandoned', 'Abandoned']], '', 'data-ps') + '</div><div class="list" id="pp" '
    + 'style="margin-top:12px"></div>';
  function load() {
    $('#pp', box).innerHTML = skel(4);
    C.api('/admin/billing/payments?status=' + status).then(function (d) {
      $('#pp', box).innerHTML = d.payments.length ? d.payments.map(payRow).join('') : '<div class="empty">'
        + icon('list') + '<p>No payments' + (status ? ' with this status' : ' yet') + '.</p></div>';
    }).catch(function (e) { fail($('#pp', box), e); });
  }
  $$('[data-ps]', box).forEach(function (b) { b.addEventListener('click', function () {
    status = b.getAttribute('data-ps');
    $$('[data-ps]', box).forEach(function (x) { x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b); });
    load(); }); });
  load();
}

export { credits };
