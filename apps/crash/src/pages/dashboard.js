/* Colon JetX · Dashboard: account, session status, today's stats, the honest baseline at the target, the verdict
   (WAIT until the analysis engine exists), guardrails, the round collector and the recent rounds and bets. In the
   Colon JetX Android app (v0.34.0) it also shows the betting site's status and the control mode, and opens the site
   in the top pane; since v0.35.0 it shows the app's collector live and can turn it on or off, and since v0.35.1
   its diagnostics (game frames seen, history strip found; v0.35.2 multipliers, canvases, a sample) right under
   the app's line. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { baselineCard, betRows, collectorCard, fail, head, roundChips, skel, stat, tone, verdictCard }
  from '../components/cards.js';
import { crashApi } from '../core/api.js';
import * as app from '../core/native.js';
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
      + '</div>' : '<p class="small muted">No session running. One starts when the Colon JetX app collects a round.'
      + '</p>')
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

// The Colon JetX app's line: the betting site's state (host only) and the control mode.
function appCard(st) {
  var d = app.describe(st);
  return '<span class="status-dot' + (d.tone ? ' ' + d.tone : '') + '"></span> Betting site: ' + esc(d.site)
    + '<br><span class="tiny muted">Control: ' + esc(d.mode) + '</span>';
}

// The app's own collector line, with its switch.
function collectorLine(c) {
  if (!c) return '';
  var d = app.describeCollector(c);
  return '<p class="small cx-rails"><span class="status-dot' + (d.tone ? ' ' + d.tone : '') + '"></span> This phone: '
    + esc(d.text) + '</p>' + (d.detail ? '<p class="tiny muted">' + esc(d.detail) + '</p>' : '')
    + '<button class="btn block" type="button" data-coll="' + (d.on ? 'off' : 'on') + '">'
    + icon(d.on ? 'stop' : 'play') + (d.on ? 'Turn the collector off' : 'Turn the collector on') + '</button>';
}

function render(view, d, paintApp) {
  var s = d.settings, inApp = app.inApp();
  var site = inApp && s.site_url ? '<button class="btn block" type="button" id="cx-open-site">' + icon('external')
    + 'Show my betting site</button>' : s.site_url ? '<a class="btn block" href="' + esc(s.site_url)
    + '" target="_blank" rel="noopener noreferrer">' + icon('external') + 'Open my betting site</a>'
    : '<a class="btn block" href="#/settings">' + icon('link') + 'Add your betting site</a>';
  // In the app the collector card sits right under the app's line, so its status is seen without scrolling.
  var coll = collectorCard(d.collector, s.target_cashout);
  $('#cx-body', view).innerHTML = (inApp ? '<section class="card"><div class="section-title">Colon JetX app</div>'
    + '<p class="small" id="cx-app"></p></section>' + coll : '') + accountCard(d) + verdictCard(d.verdict)
    + baselineCard(d.baseline, d.today.hit_rate) + (inApp ? '' : coll)
    + todayCard(d) + sessionCard(d)
    + '<section class="card"><div class="cx-sec"><div class="section-title">Recent rounds</div><a class="small" '
    + 'href="#/history">See all</a></div>' + roundChips(d.recent_rounds, s.target_cashout)
    + '<p class="tiny muted">Green: reached ' + mult(s.target_cashout) + '.</p></section>'
    + '<section class="card"><div class="cx-sec"><div class="section-title">Recent bets</div><a class="small" '
    + 'href="#/history">See all</a></div>' + betRows(d.recent_bets, s.currency) + '</section>'
    + '<div class="cx-actions">' + site + '<a class="btn block" href="#/settings">' + icon('settings')
    + 'Settings</a></div>';
  var open = $('#cx-open-site', view);
  if (open) open.onclick = function () { app.openSite(s.site_url).catch(function (e) { C.toast(e.message); }); };
  paintApp();
}

function dashboard(view) {
  var first = (C.user.name || '').split(' ')[0];
  view.innerHTML = head(first ? 'Hello, ' + first : 'JetX dashboard', 'JetX companion · target, guardrails and '
    + 'the honest odds') + '<div id="cx-body">' + skel(4) + '</div>';
  var stop = false, st = null, offs = [], soon = null;
  var paintApp = function () {
    var el = $('#cx-app', view), c = $('#cx-coll-app', view);
    if (el) el.innerHTML = appCard(st);
    if (c) c.innerHTML = collectorLine(st && st.collector);
    var b = c && $('[data-coll]', c);
    if (b) b.onclick = function () {
      app.setCollector(b.getAttribute('data-coll') === 'on').then(function (x) { st.collector = x; paintApp(); })
        .catch(function (e) { C.toast(e.message, 'bad'); });
    };
  };
  if (app.inApp()) {
    app.appStatus().then(function (s) { st = s; paintApp(); }).catch(function () {});
    offs.push(app.on('session', function (x) { st = st || {}; st.session = x; paintApp(); }));
    offs.push(app.on('mode', function (x) { st = st || {}; st.mode = x.mode; paintApp(); }));
    // A new round: the line at once, the saved counts a few seconds later (after the app has sent it). A
    // diagnostic only (frames, strip) repaints the line without reloading.
    offs.push(app.on('collector', function (x) {
      var was = (st && st.collector) || {};
      st = st || {}; st.collector = x; paintApp();
      var moved = x.rounds_today !== was.rounds_today || x.last_multiplier !== was.last_multiplier
        || x.rounds_sent !== was.rounds_sent;
      if (moved && !soon) soon = setTimeout(function () { soon = null; if (!stop) load(); }, 8000);
    }));
  }
  var load = function () {
    crashApi.dashboard().then(function (d) { if (!stop) render(view, d, paintApp); }).catch(function (e) {
      if (!stop) fail($('#cx-body', view), e); });
  };
  load();
  var timer = setInterval(function () { if (!document.hidden) load(); }, 30000);
  return function () { stop = true; clearInterval(timer); clearTimeout(soon); offs.forEach(function (off) { off(); });
  };
}

export { dashboard };
