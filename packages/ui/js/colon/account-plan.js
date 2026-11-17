/* Colon App core · Plan & credits screen (v0.13.0, Blueprint A8): the user's plan, this month's credits, the
   plans on sale and Korapay checkout. Prices and plans come from GET /account/billing; the server alone grants a
   plan, after it has verified the payment with Korapay. The page only shows what the server says. */

import { api } from './api.js';
import { $, $$, ago, esc } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';
import { state } from './state.js';

var PENDING = 'colon.payment.pending';
var FEATURE_NAMES = { ai_credits: 'AI credits a month', image_credits: 'images a month',
  research_tasks: 'research tasks a month', projects: 'projects', background_jobs: 'background jobs a month' };

function naira(minor) {
  var n = Math.round(Number(minor || 0) / 100);
  return '₦' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function num(n) { return Number(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function pending(v) {
  try { if (v === undefined) return localStorage.getItem(PENDING) || ''; if (v) localStorage.setItem(PENDING, v);
    else localStorage.removeItem(PENDING); } catch (e) {}
  return '';
}

function features(p) {
  var e = p.entitlements || {};
  return Object.keys(FEATURE_NAMES).filter(function (k) { return e[k] != null; }).map(function (k) {
    return '<li>' + icon('check') + '<span>' + esc(num(e[k])) + ' ' + FEATURE_NAMES[k] + '</span></li>'; }).join('');
}

function planCard(p, current, canBuy) {
  var mine = current === p.code, free = !Number(p.price_minor);
  var btn = mine ? '<span class="badge ok">Your plan</span>'
    : free ? '' : '<button class="btn primary block" type="button" data-buy="' + esc(p.code) + '"'
      + (canBuy ? '' : ' disabled') + '>' + (current && current !== 'free' ? 'Switch to ' : 'Get ') + esc(p.name)
      + '</button>';
  return '<div class="card plan-card' + (mine ? ' mine' : '') + '"><div class="plan-head"><div class="h2">'
    + esc(p.name) + '</div><div class="plan-price">'
    + (free ? 'Free' : naira(p.price_minor) + '<span class="small muted"> / month</span>')
    + '</div></div><ul class="plan-feats">' + features(p) + '</ul>' + btn + '</div>';
}

function render(view, d) {
  var cr = d.credits || {}, planName = d.plan ? d.plan.name : 'Free';
  var used = cr.monthly ? Math.max(0, Math.min(100, Math.round(100 * (cr.monthly - cr.balance) / cr.monthly))) : 0;
  var top = !d.billable ? '<div class="card"><div class="h2">Not billed</div>'
      + '<p class="small muted" style="margin:6px 0 0">'
      + (state.user && state.user.role !== 'user' ? 'Staff accounts are not charged.' : 'Your account is not billed.')
      + '</p></div>'
    : '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px">'
      + '<div><div class="small muted">Current plan</div><div class="h2">' + esc(planName) + '</div></div>'
      + (d.subscription && d.subscription.period_end ? '<span class="badge cyan">Until '
        + esc(new Date(d.subscription.period_end).toLocaleDateString()) + '</span>' : '') + '</div>'
      + '<div style="margin-top:14px;display:flex;justify-content:space-between" class="small"><span>'
      + esc(num(cr.balance)) + ' credits left</span><span class="muted">of ' + esc(num(cr.monthly)) + '</span></div>'
      + '<div class="meter" style="margin-top:6px" aria-hidden="true"><i style="width:' + (100 - used)
      + '%;background:var(--primary)"></i></div>'
      + '<p class="tiny muted" style="margin:8px 0 0">Credits reset on ' + esc(cr.renews || 'the 1st')
      + ' and don’t roll over.' + (d.mode === 'shadow' ? ' Usage is counted but not limited yet.' : '') + '</p></div>';
  var canBuy = d.billable && d.payments !== false;
  var plans = (d.plans || []).map(function (p) { return planCard(p, d.plan ? d.plan.code : 'free', canBuy); }).join('');
  var payNote = d.billable && d.payments === false
    ? '<p class="small muted">Paid plans open soon. Payments aren’t switched on yet.</p>'
    : '<p class="tiny muted">Paid securely with Korapay (card or bank transfer). Each payment covers 30 days; '
      + 'paying again for the same plan adds 30 more. No automatic renewals.</p>';
  var hist = (d.payments_recent || []).length ? '<div class="section-title">Payments</div><div class="list">'
    + d.payments_recent.map(function (p) {
      return '<div class="set-row"><span class="ico">' + icon(p.status === 'success' ? 'check' : p.status
        === 'pending' ? 'clock' : 'x') + '</span><span class="body"><div class="title">' + esc(p.plan_name || p.plan)
        + ' · ' + naira(p.amount_minor) + '</div><div class="sub">' + esc({ success: 'Paid', pending: 'Waiting',
        failed: 'Failed', abandoned: 'Not completed' }[p.status] || p.status) + ' · ' + esc(ago(p.paid_at
        || p.created_at)) + '</div></span></div>'; }).join('') + '</div>' : '';
  view.innerHTML = '<h1 class="h1">Plan &amp; credits</h1><p class="lead">What you have this month, and more if you '
    + 'need it.</p><div data-pay-status></div>' + top + (d.billable ? '<div class="section-title">Plans</div>'
    + '<div class="plan-grid">' + plans + '</div>' + payNote : '') + hist;
  $$('[data-buy]', view).forEach(function (b) { b.addEventListener('click', function () { buy(b); }); });
}

function buy(b) {
  var code = b.getAttribute('data-buy');
  b.disabled = true; b.textContent = 'Opening Korapay…';
  api('/account/billing/checkout', { method: 'POST', body: { plan: code } }).then(function (r) {
    if (!r.checkout_url || !/^https:\/\//.test(r.checkout_url)) throw new Error('Checkout is not available.');
    pending(r.reference);
    location.href = r.checkout_url;
  }).catch(function (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Try again'; });
}

// After Korapay sends the user back (or they come back to the tab), ask the server what happened.
function checkPending(view, reload) {
  var ref = pending(); if (!ref) return;
  var box = $('[data-pay-status]', view);
  if (box) box.innerHTML = '<div class="card small">' + icon('clock') + ' Checking your payment…</div>';
  api('/account/billing/payments/' + encodeURIComponent(ref)).then(function (p) {
    if (p.status === 'pending') {
      if (box) box.innerHTML = '<div class="card small">Your payment isn’t confirmed yet. If you paid by transfer '
        + 'it can take a few minutes. <button class="btn" type="button" data-recheck>Check again</button></div>';
      var rb = box && $('[data-recheck]', box); if (rb) rb.addEventListener('click', function () {
        checkPending(view, reload); });
      return;
    }
    pending(null);
    if (p.status === 'success') { toast('Payment received. Your plan is active.', 'ok'); reload(); }
    else if (box) box.innerHTML = '<div class="card small">That payment didn’t go through, so nothing was '
      + 'charged for a plan. You can try again.</div>';
  }).catch(function (e) {
    if (e.status === 404) { pending(null); if (box) box.innerHTML = ''; return; }
    if (box) box.innerHTML = '<div class="card small">' + esc(e.message) + '</div>';
  });
}

function planPage(view, ctx) {
  var ref = ctx && ctx.query && ctx.query.get('reference');
  if (ref && /^[A-Za-z0-9_-]{6,80}$/.test(ref)) pending(ref);
  function load() {
    view.innerHTML = '<div class="card"><div class="skel" style="height:90px"></div></div>';
    api('/account/billing').then(function (d) { render(view, d); checkPending(view, load); })
      .catch(function (e) { view.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; });
  }
  load();
  function onShow() { if (document.visibilityState === 'visible' && pending()) checkPending(view, load); }
  document.addEventListener('visibilitychange', onShow);
  return function () { document.removeEventListener('visibilitychange', onShow); };
}

// Korapay returns to https://chat…/?payment=korapay&reference=…; send that to the plan page.
function paymentReturn() {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('payment') !== 'korapay') return;
    var ref = q.get('reference') || '';
    history.replaceState(null, '', location.pathname + '#/account/plan' + (ref ? '?reference='
      + encodeURIComponent(ref) : ''));
  } catch (e) {}
}

export { naira, paymentReturn, planPage };
