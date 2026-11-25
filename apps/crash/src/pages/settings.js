/* Colon JetX · Settings: target cash-out, stake, demo mode (with the real-money warning before it goes off),
   guardrails, the one-tap kill switch and the betting site the user opens and signs in to themselves. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { fail, head, skel } from '../components/cards.js';
import { crashApi } from '../core/api.js';
import { pct } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$;
var NUM = ['target_cashout', 'stake', 'stake_cap', 'stop_loss', 'daily_loss_limit', 'max_bets_per_session'];

function sw(name, label, sub, on) {
  return '<label class="set-row"><span class="body"><span class="title">' + esc(label) + '</span>' + (sub
    ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span><span class="switch"><input type="checkbox" name="'
    + name + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(label) + '"><i></i></span></label>';
}
function num(name, label, value, mode) {
  return C.field({ name: name, label: label, value: value, type: 'text', mode: mode || 'decimal', auto: 'off' });
}
var baseOf = function (t) { var n = Number(t); return n >= 1 ? Math.min(1, 0.97 / n) : null; };

function killCard(s) {
  return '<section class="card cx-kill' + (s.kill_switch ? ' on' : '') + '"><div class="body"><div class="title">'
    + 'Kill switch</div><div class="sub">' + (s.kill_switch ? 'On: no bets will be placed.'
    : 'One tap stops all betting at once.') + '</div></div><button type="button" class="btn ' + (s.kill_switch
    ? 'primary' : 'danger solid') + '" data-kill>' + icon(s.kill_switch ? 'play' : 'stop') + (s.kill_switch
    ? 'Turn off' : 'Stop betting') + '</button></section>';
}

function form(s) {
  return '<form class="cx-form" novalidate><section class="card"><div class="section-title">Cash-out and stake'
    + '</div>' + num('target_cashout', 'Target cash-out (x)', s.target_cashout.toFixed(2))
    + '<p class="tiny muted" id="cx-base"></p>' + num('stake', 'Stake per bet', s.stake)
    + C.field({ name: 'currency', label: 'Currency', value: s.currency, max: 3, auto: 'off' }) + '</section>'
    + '<section class="card"><div class="section-title">Mode</div>' + sw('demo_mode', 'Demo mode',
      'Bets are simulated: no real money. On by default.', s.demo_mode)
    + '<p class="tiny muted">Switching to real money asks you to confirm first.</p></section>'
    + '<section class="card"><div class="section-title">Guardrails</div>'
    + num('stake_cap', 'Stake cap (largest single bet)', s.stake_cap)
    + num('stop_loss', 'Stop-loss per session', s.stop_loss)
    + num('daily_loss_limit', 'Daily loss limit', s.daily_loss_limit)
    + num('max_bets_per_session', 'Max bets per session', s.max_bets_per_session, 'numeric')
    + '<p class="tiny muted">Every bet and every change here is written to your audit log.</p></section>'
    + '<section class="card"><div class="section-title">Betting site</div>'
    + C.field({ name: 'site_url', label: 'Site address', value: s.site_url || '', placeholder: 'https://…',
      required: false, type: 'url', auto: 'off' })
    + '<p class="tiny muted">You open it and sign in yourself. Colon never asks for or stores your betting password.'
    + '</p></section><button class="btn primary block" type="submit">' + icon('check') + 'Save settings</button>'
    + '</form>';
}

function settingsPage(view) {
  view.innerHTML = head('Settings', 'Target, stake, mode and guardrails') + '<div id="cx-set">' + skel(4) + '</div>';
  var box = $('#cx-set', view), current = null, warning = '';

  function draw() {
    box.innerHTML = killCard(current) + form(current);
    var f = $('form', box), t = $('[name=target_cashout]', f), note = $('#cx-base', box);
    var show = function () { var p = baseOf(t.value); note.textContent = p == null ? 'Between 1.01x and 100x.'
      : 'Baseline: a round reaches this about ' + pct(p) + ' of the time; each bet loses about 3% on average.'; };
    t.addEventListener('input', show); show();
    $('[data-kill]', box).addEventListener('click', function () {
      save({ kill_switch: !current.kill_switch }).catch(function (e) { C.toast(e.message, 'bad'); });
    });
    C.bindForm(f, function (data) {
      var body = {};
      NUM.forEach(function (k) { body[k] = data[k] === '' ? '' : Number(data[k]); });
      body.currency = data.currency; body.site_url = data.site_url; body.demo_mode = data.demo_mode;
      if (current.demo_mode && body.demo_mode === false) {
        return C.confirm({ title: 'Switch to real money?', body: warning, confirm: 'I understand, use real money',
          danger: true, icon: 'alert' }).then(function (ok) {
          if (!ok) { $('[name=demo_mode]', f).checked = true; return; }
          body.confirm_real_money = true; return save(body);
        });
      }
      return save(body);
    });
  }

  function save(body) {
    return crashApi.saveSettings(body).then(function (r) {
      current = r.settings; draw();
      C.toast(r.changed.length ? 'Settings saved' : 'Nothing changed', 'ok');
    });
  }

  crashApi.settings().then(function (d) { current = d.settings; warning = d.warning; draw(); })
    .catch(function (e) { fail(box, e); });
}

export { settingsPage };
