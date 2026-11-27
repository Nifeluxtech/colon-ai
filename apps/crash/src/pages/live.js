/* Colon JetX · Live (v0.38.0): the compact Colon panel for the app's side-by-side layout (game left, this right).
   It lists the multipliers Colon has recorded, newest first, and the analyser's suggestion for the next round:
   BET / WAIT / STOP with its reason, the target and the engine's estimated chance of reaching it. An estimate, never
   a guarantee. 0.39.2: no percentage until the engine has one (10 rounds); until then "3/10 rounds".
   It refreshes when the app's collector records a round and every 10 seconds. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { fail, skel } from '../components/cards.js';
import { crashApi } from '../core/api.js';
import * as app from '../core/native.js';
import { mult, pct } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$;

// The estimate, or how many rounds the engine still needs: never the baseline in its place.
function chance(e) {
  if (e.chance == null) {
    var m = e.min_rounds || 10;
    return '<b>' + Math.min(e.rounds || 0, m) + '/' + m + '</b> <span class="tiny muted">rounds</span>';
  }
  return '<b>' + pct(e.chance) + '</b> <span class="tiny muted">estimated chance</span>';
}

function suggestion(d) {
  var v = d.verdict || {}, a = v.action || 'WAIT', e = d.estimate || {};
  return '<section class="card cx-verdict cx-' + a.toLowerCase() + ' cx-live-v"><div class="cx-verdict-k">Next round'
    + ' at ' + mult(d.target) + '</div><div class="cx-verdict-a">' + esc(a) + '</div><div class="cx-live-est">'
    + chance(e) + '</div><p class="small">'
    + esc(v.reason || '') + '</p><p class="tiny muted">' + esc(e.label || 'An estimate, not a guarantee.') + '</p>'
    + (d.kill_switch ? '<p class="small"><span class="status-dot bad"></span> Kill switch on: no bets.</p>' : '')
    + '</section>';
}

function list(d) {
  if (!d.recent.length) {
    return '<div class="empty small">No rounds recorded yet. Keep JetX open on the left; Colon records each round.'
      + '</div>';
  }
  return '<ol class="cx-live-list">' + d.recent.map(function (r) {
    return '<li class="' + (r.hit ? 'hit' : '') + '"><b>' + mult(r.multiplier) + '</b><span class="tiny muted">'
      + C.ago(r.observed_at) + '</span></li>';
  }).join('') + '</ol>';
}

function livePage(view) {
  view.innerHTML = '<div id="cx-live">' + skel(2) + '</div>';
  var box = $('#cx-live', view), stop = false, offs = [], line = '';
  function draw(d) {
    box.innerHTML = suggestion(d) + '<section class="card"><div class="cx-sec"><div class="section-title">Recorded'
      + '</div><span class="tiny muted">newest first</span></div>' + list(d) + '</section><p class="tiny muted" '
      + 'id="cx-live-app">' + esc(line) + '</p><p class="small"><a href="#/">' + icon('grid') + ' Dashboard</a> · '
      + '<a href="#/autobet">' + icon('target') + ' Auto-bet</a></p>';
  }
  function load() {
    crashApi.live(30).then(function (d) { if (!stop) draw(d); }).catch(function (e) { if (!stop) fail(box, e); });
  }
  if (app.inApp()) {
    offs.push(app.on('collector', function (c) {
      line = app.collectorDetail(c);
      var el = $('#cx-live-app', box);
      if (el) el.textContent = line;
    }));
    // The app tells the page once the API has stored a round (its 'autobet' or 'collector' events follow it).
    var last = null;
    offs.push(app.on('collector', function (c) {
      if (c && c.rounds_today !== last) { last = c.rounds_today; setTimeout(function () { if (!stop) load(); }, 600); }
    }));
  }
  load();
  var timer = setInterval(function () { if (!document.hidden) load(); }, 10000);
  return function () { stop = true; clearInterval(timer); offs.forEach(function (off) { off(); }); };
}

export { livePage };
