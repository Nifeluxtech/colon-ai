/* Colon JetX · Dashboard: account, session status, today's stats, the honest baseline at the target, the verdict
   (WAIT until the analysis engine exists), guardrails and the recent rounds and bets. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { baselineCard, betRows, fail, head, roundChips, skel, stat, tone, verdictCard } from '../components/cards.js';
import { crashApi } from '../core/api.js';
import { money, mult, signed } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$;

function accountCard(d) {
  var a = d.account, s = d.settings;
  return '<section class="card cx-account"><div class="avatar">' + esc(C.initials(a.name || a.email)) + '</div>'
    + '<div class="body"><div class="title">' + esc(a.name || 'Colon member') + '</div><div class="sub">'
    + esc(a.email) + '</div></div>' + (s.demo_mode ? '<span class="badge ok">' + icon('shield') + 'Demo mode</span>'
    : '<span class="badge warn">' + icon('alert') + 'Real money</span>') + '</section>';
}

function sessionCard(d) {
  var s = d.session, g = d.guardrails, cur = d.settings.currency;
  var status = g.status === 'ok' ? '<span class="status-dot"></span> Guardrails clear'
    : '<span class="status-dot bad"></span> Stopped: ' + esc(g.reasons.map(function (r) { return r.message; })
      .join(' '));
  return '<section class="card"><div class="section-title">Session</div>'
    + (s ? '<p class="small">' + (s.demo ? 'Demo' : 'Real-money') + ' session since ' + C.ago(s.started_at)
      + '</p><div class="grid cols-2">' + stat(String(s.bets), 'Bets this session')
      + stat('<span class="' + tone(s.profit) + '">' + signed(s.profit) + '</span>', 'Session P/L (' + cur + ')')
      + '</div>' : '<p class="small muted">No session running. Sessions start from the inbuilt browser in a later '
      + 'step.</p>')
    + '<p class="small cx-rails">' + status + '</p><p class="tiny muted">' + g.bets_left + ' bets left this session'
    + ' · ' + money(g.loss_left_today, cur) + ' left before the daily loss limit</p></section>';
}

function todayCard(d) {
  var t = d.today, cur = d.settings.currency;
  return '<section><div class="section-title">Today</div><div class="grid cols-4">'
    + stat(String(t.hit_rate.rounds), 'Rounds seen') + stat(String(t.bets), 'Bets')
    + stat(t.wins + ' / ' + t.losses, 'Won / lost')
    + stat('<span class="' + tone(t.profit) + '">' + signed(t.profit) + '</span>', 'P/L (' + cur + ')')
    + '</div></section>';
}

function render(view, d) {
  var s = d.settings;
  var site = s.site_url ? '<a class="btn block" href="' + esc(s.site_url) + '" target="_blank" rel="noopener '
    + 'noreferrer">' + icon('external') + 'Open my betting site</a>' : '<a class="btn block" href="#/settings">'
    + icon('link') + 'Add your betting site</a>';
  $('#cx-body', view).innerHTML = accountCard(d) + verdictCard(d.verdict) + baselineCard(d.baseline, d.today.hit_rate)
    + todayCard(d) + sessionCard(d)
    + '<section class="card"><div class="cx-sec"><div class="section-title">Recent rounds</div><a class="small" '
    + 'href="#/history">See all</a></div>' + roundChips(d.recent_rounds, s.target_cashout)
    + '<p class="tiny muted">Green: reached ' + mult(s.target_cashout) + '.</p></section>'
    + '<section class="card"><div class="cx-sec"><div class="section-title">Recent bets</div><a class="small" '
    + 'href="#/history">See all</a></div>' + betRows(d.recent_bets, s.currency) + '</section>'
    + '<div class="cx-actions">' + site + '<a class="btn block" href="#/settings">' + icon('settings')
    + 'Settings</a></div>';
}

function dashboard(view) {
  var first = (C.user.name || '').split(' ')[0];
  view.innerHTML = head(first ? 'Hello, ' + first : 'JetX dashboard', 'JetX companion · target, guardrails and '
    + 'the honest odds') + '<div id="cx-body">' + skel(4) + '</div>';
  var stop = false;
  var load = function () {
    crashApi.dashboard().then(function (d) { if (!stop) render(view, d); }).catch(function (e) {
      if (!stop) fail($('#cx-body', view), e); });
  };
  load();
  var timer = setInterval(function () { if (!document.hidden) load(); }, 30000);
  return function () { stop = true; clearInterval(timer); };
}

export { dashboard };
