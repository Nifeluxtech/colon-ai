/* Colon JetX · building blocks: page header, stats, the verdict, the honest baseline, the round collector (v0.35.0),
   round chips and bet rows. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { money, mult, pct, signed } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc;

function head(title, lead, action) {
  return '<div class="cx-head"><div><h1 class="h1">' + esc(title) + '</h1>' + (lead ? '<p class="lead">' + esc(lead)
    + '</p>' : '') + '</div>' + (action || '') + '</div>';
}
function skel(n) {
  var s = ''; for (var i = 0; i < (n || 3); i++) s += '<div class="skel" style="height:64px;margin-top:12px"></div>';
  return s;
}
function fail(el, e) {
  el.innerHTML = '<div class="card empty">' + icon('alert') + '<p>' + esc(e.message) + '</p>'
    + '<button class="btn" type="button" onclick="location.reload()">' + icon('refresh') + 'Try again</button></div>';
}
function stat(value, label, cls) {
  return '<div class="stat' + (cls ? ' ' + cls : '') + '"><b>' + value + '</b><span>' + esc(label) + '</span></div>';
}
var tone = function (n) { return Number(n) > 0 ? 'cx-up' : Number(n) < 0 ? 'cx-down' : ''; };

// verdict: { action: 'BET'|'WAIT'|'STOP', reason, engine }
function verdictCard(v) {
  var a = (v && v.action) || 'WAIT';
  return '<section class="card cx-verdict cx-' + a.toLowerCase() + '" aria-live="polite"><div class="cx-verdict-k">'
    + 'Verdict</div><div class="cx-verdict-a">' + esc(a) + '</div><p class="small">' + esc(v && v.reason || '')
    + '</p><p class="tiny muted">Not a prediction. No pattern beats a fair crash game; Colon only says BET when a '
    + 'tested model shows an edge on rounds it has not seen.</p></section>';
}

// b: dashboard.baseline, h: today.hit_rate
function baselineCard(b, h) {
  var measured = h && h.rounds ? pct(h.rate) + ' <small>(' + pct(h.low, 0) + '–' + pct(h.high, 0) + ')</small>'
    : '—';
  var read = !h || !h.rounds ? 'No rounds recorded today yet. Open JetX in the Colon JetX app, or import a CSV.'
    : h.above === true ? 'Above the baseline so far today. Short runs like this happen by chance.'
      : h.above === false ? 'Below the baseline so far today. Short runs like this happen by chance.'
        : 'Within the normal range of the baseline: no edge shown.';
  return '<section class="card cx-base"><div class="section-title">At ' + mult(b.target) + '</div>'
    + '<div class="grid cols-2">' + stat(pct(b.probability), 'Baseline chance per round', 'cx-hl')
    + stat(measured, 'Measured today (' + (h ? h.rounds : 0) + ' rounds)') + '</div>'
    + '<p class="small">' + esc(read) + '</p><p class="tiny muted">JetX returns about ' + pct(b.rtp, 0)
    + ', so a round reaches ' + mult(b.target) + ' with about ' + pct(b.probability) + ' chance whatever came '
    + 'before, and each bet loses about ' + pct(-b.expected_return, 0) + ' of its stake on average.</p></section>';
}

var COLL = { live: 'Live', idle: 'Waiting for rounds', off: 'Not collecting' };

// c: dashboard.collector { status: live|idle|off, rounds_today, last_multiplier, last_round_at }
function collectorCard(c, target) {
  c = c || { status: 'off', rounds_today: 0, last_multiplier: null };
  var dot = c.status === 'live' ? '' : c.status === 'idle' ? ' warn' : ' bad', m = c.last_multiplier;
  return '<section class="card cx-coll"><div class="cx-sec"><div class="section-title">Round collector</div>'
    + '<span class="small"><span class="status-dot' + dot + '"></span> ' + esc(COLL[c.status] || c.status)
    + '</span></div><div class="grid cols-2">' + stat(String(c.rounds_today || 0), 'Collected today')
    + stat(m == null ? '—' : '<span class="' + (m >= target ? 'cx-up' : 'cx-down') + '">' + mult(m) + '</span>',
      'Last round' + (c.last_round_at ? ' · ' + C.ago(c.last_round_at) : '')) + '</div><div id="cx-coll-app"></div>'
    + '<p class="tiny muted">The Colon JetX Android app records each finished JetX round while your site is open. '
    + 'It reads only the multipliers, never your password or account. You can also import a CSV or add rounds in '
    + '<a href="#/history">History</a>.</p></section>';
}

function roundChips(rounds, target) {
  if (!rounds.length) return '<div class="empty small">No rounds yet.</div>';
  return '<div class="cx-chips">' + rounds.map(function (r) {
    return '<span class="cx-chip' + (r.multiplier >= target ? ' hit' : '') + '" title="Round ' + esc(r.round_id)
      + '">' + mult(r.multiplier) + '</span>';
  }).join('') + '</div>';
}

function betRows(bets, currency) {
  if (!bets.length) return '<div class="empty small">No bets yet. Auto-bet arrives in a later step.</div>';
  return '<div class="list">' + bets.map(function (b) {
    var res = b.outcome === 'won' || b.outcome === 'lost' ? b.payout - b.stake : 0;
    return '<div class="row"><span class="ico">' + icon(b.outcome === 'won' ? 'check' : b.outcome === 'lost' ? 'x'
      : 'clock') + '</span><span class="body"><div class="title">' + money(b.stake, currency) + ' at '
      + mult(b.target) + (b.demo ? ' <span class="badge">Demo</span>' : ' <span class="badge warn">Real</span>')
      + '</div><div class="sub">' + esc(b.outcome) + ' · ' + C.ago(b.placed_at) + '</div></span><b class="'
      + tone(res) + '">' + signed(res) + '</b></div>';
  }).join('') + '</div>';
}

export { baselineCard, betRows, collectorCard, fail, head, roundChips, skel, stat, tone, verdictCard };
