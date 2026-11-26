/* Colon JetX · Auto-bet (v0.37.0, Crash Predictor step 5): the mode (demo or real money), the demo balance, the
   guardrails (editable here), the kill switch, the bet log (Colon's auto bets and the user's own bets, demo and real
   labelled) and the hit rate against the baseline (0.97 / target) and break-even (1 / target). In the Colon JetX
   app it also shows the app's real-money switch, which the app guards with its own warning. Never a guarantee. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { fail, head, skel, stat, tone } from '../components/cards.js';
import { crashApi } from '../core/api.js';
import * as app from '../core/native.js';
import { money, mult, pct, signed } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$;
var RAILS = ['target_cashout', 'stake', 'stake_cap', 'stop_loss', 'daily_loss_limit', 'max_bets_per_session'];
var LABEL = { target_cashout: 'Target auto cash-out (x)', stake: 'Stake per bet', stake_cap: 'Stake cap',
  stop_loss: 'Stop-loss per session', daily_loss_limit: 'Daily loss limit',
  max_bets_per_session: 'Max bets per session' };

function modeCard(d) {
  var s = d.settings, b = d.demo_balance;
  return '<section class="card"><div class="cx-sec"><div class="section-title">Mode</div>' + (d.mode === 'demo'
    ? '<span class="badge ok">' + icon('shield') + 'Demo</span>' : '<span class="badge warn">' + icon('alert')
    + 'Real money</span>') + '</div><div class="grid cols-2">'
    + stat(money(b.balance, b.currency), 'Demo balance (simulated)', 'cx-hl')
    + stat('<span class="' + tone(b.profit) + '">' + signed(b.profit) + '</span>', 'Demo P/L since start') + '</div>'
    + '<p class="tiny muted">Demo bets are never clicked: Colon records them and settles each one against the next '
    + 'round the collector records. Real money needs both your account out of demo mode (<a href="#/settings">'
    + 'Settings</a>) and the Colon JetX app’s own real-money switch' + (s.demo_mode ? '' : ' (your account is '
    + 'out of demo mode)') + '.</p><div id="cx-ab-app"></div></section>';
}

function killCard(d) {
  var on = d.settings.kill_switch;
  return '<section class="card cx-kill' + (on ? ' on' : '') + '"><div class="body"><div class="title">Kill switch'
    + '</div><div class="sub">' + (on ? 'On: no bets. Turn it off in Settings.' : 'One tap stops every auto bet now.')
    + '</div></div>' + (on ? '' : '<button type="button" class="btn danger solid" data-stop>' + icon('stop')
    + 'Stop betting</button>') + '</section>';
}

function decisionCard(d) {
  var v = d.verdict || {}, n = d.decision_now || {}, g = d.guardrails[d.mode] || {};
  return '<section class="card cx-verdict cx-' + String(v.action || 'WAIT').toLowerCase() + '">'
    + '<div class="cx-verdict-k">Next round</div><div class="cx-verdict-a">' + esc(v.action || 'WAIT')
    + '</div><p class="small">'
    + esc(n.allow ? 'Auto-bet would bet ' + money(n.stake) + ' at ' + mult(n.target) + ' now.'
      : 'No auto bet now: ' + (n.reason || '')) + '</p><p class="tiny muted">Guardrails (' + esc(d.mode) + '): '
    + (g.status === 'ok' ? 'clear' : esc((g.reasons || []).map(function (r) { return r.message; }).join(' ')))
    + ' · ' + (g.bets_left == null ? '—' : g.bets_left) + ' bets left this session · '
    + money(g.loss_left_today) + ' left today</p></section>';
}

function rateRow(name, g) {
  var range = g.settled ? pct(g.low, 0) + '–' + pct(g.high, 0) : '—';
  return '<tr><th scope="row">' + esc(name) + '</th><td>' + g.settled + '</td><td>' + pct(g.hit_rate) + '</td><td>'
    + range + '</td><td>' + pct(g.baseline) + '</td><td>' + pct(g.break_even) + '</td><td class="' + tone(g.profit)
    + '">' + signed(g.profit) + '</td></tr>';
}

function rateCard(d) {
  var s = d.stats, h = d.honest;
  return '<section class="card"><div class="section-title">Hit rate vs the honest odds</div><div class="cx-table-wrap">'
    + '<table class="cx-table"><thead><tr><th></th><th>Settled</th><th>Hit rate</th><th>95% range</th>'
    + '<th>Baseline</th><th>Break-even</th><th>P/L</th></tr></thead><tbody>' + rateRow('Auto (Colon)', s.auto)
    + rateRow('Manual (you)', s.manual) + rateRow('Demo', s.demo) + rateRow('Real', s.real) + '</tbody></table></div>'
    + '<p class="tiny muted">At ' + mult(h.target) + ' a round gets there about ' + pct(h.baseline) + ' of the time '
    + '(baseline 0.97 / target), but a bet needs ' + pct(h.break_even) + ' to break even (1 / target). A hit rate '
    + 'between them still loses money. ' + esc(h.min_auto_note) + '</p></section>';
}

function railsForm(s) {
  return '<form class="card cx-form" id="cx-ab-form" novalidate><div class="section-title">Guardrails</div>'
    + RAILS.map(function (k) {
      return C.field({ name: k, label: LABEL[k], value: k === 'target_cashout' ? s[k].toFixed(2) : s[k],
        type: 'text', mode: k === 'max_bets_per_session' ? 'numeric' : 'decimal', auto: 'off' });
    }).join('') + '<p class="tiny muted">Every change and every bet is written to your audit log.</p>'
    + '<button class="btn primary block" type="submit">' + icon('check') + 'Save guardrails</button></form>';
}

function betLog(bets, currency) {
  if (!bets.length) return '<div class="empty small">No bets yet.</div>';
  return '<div class="list">' + bets.map(function (b) {
    var res = b.outcome === 'won' || b.outcome === 'lost' ? b.payout - b.stake : 0;
    var who = b.source === 'manual' ? '<span class="badge">You</span>' : '<span class="badge ok">Colon</span>';
    var mode = b.demo ? '<span class="badge">Demo</span>' : '<span class="badge warn">Real</span>';
    var detail = esc(b.outcome) + (b.multiplier != null ? ' · round ' + mult(b.multiplier) : '')
      + (b.cashout != null ? ' · cashed ' + mult(b.cashout) : '') + ' · ' + C.ago(b.placed_at);
    return '<div class="row"><span class="ico">' + icon(b.outcome === 'won' ? 'check' : b.outcome === 'lost' ? 'x'
      : 'clock') + '</span><span class="body"><div class="title">' + money(b.stake, currency) + ' at '
      + (b.target == null ? 'no auto cash-out' : mult(b.target)) + ' ' + who + ' ' + mode + '</div><div class="sub">'
      + detail + '</div></span><b class="' + tone(res) + '">' + signed(res) + '</b></div>';
  }).join('') + '</div>';
}

// The app's real-money switch and phone stop (in the Colon JetX app only).
function appLine(st) {
  var a = (st && st.autobet) || {};
  return '<label class="set-row"><span class="body"><span class="title">Real-money clicks on this phone</span>'
    + '<span class="sub">Off by default. The app warns you first. Only used when your account is out of demo mode.'
    + '</span></span><span class="switch"><input type="checkbox" data-real' + (a.real_money ? ' checked' : '')
    + ' aria-label="Real-money clicks on this phone"><i></i></span></label>' + (a.stopped
    ? '<button class="btn block" type="button" data-resume>' + icon('play') + 'Allow auto-bet again on this phone'
    + '</button>' : '') + (a.line ? '<p class="tiny muted">Last: ' + esc(a.line) + '</p>' : '');
}

function autobetPage(view) {
  view.innerHTML = head('Auto-bet', 'Demo first, guardrails always. Not a guarantee.') + '<div id="cx-ab">' + skel(4)
    + '</div>';
  var box = $('#cx-ab', view), stop = false, st = null, offs = [];
  function paintApp() {
    var el = $('#cx-ab-app', box);
    if (!el || !app.inApp()) return;
    el.innerHTML = appLine(st);
    var r = $('[data-real]', el), res = $('[data-resume]', el);
    if (r) r.onchange = function () {
      app.setRealMoney(r.checked).then(function (x) { st.autobet = st.autobet || {}; st.autobet.real_money =
        x.real_money; paintApp(); }).catch(function (e) { C.toast(e.message, 'bad'); paintApp(); });
    };
    if (res) res.onclick = function () {
      app.resumeAutobet().then(function (a) { st.autobet = a; paintApp(); }).catch(function () {});
    };
  }
  function draw(d) {
    box.innerHTML = '<p class="small cx-honest card">' + esc(d.notice) + '</p>' + modeCard(d) + killCard(d)
      + decisionCard(d) + rateCard(d) + railsForm(d.settings) + '<section class="card"><div class="section-title">'
      + 'Bet log</div>' + betLog(d.bets, d.settings.currency) + '</section>';
    var k = $('[data-stop]', box);
    if (k) k.onclick = function () {
      (app.inApp() ? app.stopAutobet().catch(function () {}) : Promise.resolve()).then(crashApi.stopAll)
        .then(function () { C.toast('Stopped. No bets.', 'ok'); load(); }).catch(function (e) { C.toast(e.message); });
    };
    C.bindForm($('#cx-ab-form', box), function (data) {
      var body = {};
      RAILS.forEach(function (k2) { body[k2] = data[k2] === '' ? '' : Number(data[k2]); });
      return crashApi.saveSettings(body).then(function (r) {
        C.toast(r.changed.length ? 'Guardrails saved' : 'Nothing changed', 'ok'); load();
      });
    });
    paintApp();
  }
  function load() {
    crashApi.autobet().then(function (d) { if (!stop) draw(d); }).catch(function (e) { if (!stop) fail(box, e); });
  }
  if (app.inApp()) {
    app.appStatus().then(function (s) { st = s; paintApp(); }).catch(function () {});
    offs.push(app.on('autobet', function (a) { st = st || {}; st.autobet = a; paintApp(); }));
  }
  load();
  var timer = setInterval(function () { if (!document.hidden) load(); }, 20000);
  return function () { stop = true; clearInterval(timer); offs.forEach(function (off) { off(); }); };
}

export { autobetPage };
