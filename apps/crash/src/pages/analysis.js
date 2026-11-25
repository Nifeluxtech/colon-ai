/* Colon JetX · Analysis (v0.36.0, Crash Predictor step 4): what the user's recorded JetX rounds say, measured
   against the published odds. Hit rate vs baseline vs break-even, streaks, the distribution against the expected
   shares, independence, recent windows, and every betting rule tested only on rounds it had not seen. The verdict
   card repeats the dashboard's. Nothing here is a prediction. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { fail, head, skel, stat, verdictCard } from '../components/cards.js';
import { crashApi } from '../core/api.js';
import { mult, pct } from '../core/state.js';

var C = Colon, esc = C.esc, $ = C.$;

var range = function (h) { return h && h.low != null ? pct(h.low) + '–' + pct(h.high) : '—'; };
var signedPct = function (x) { return x == null ? '—' : (x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; };

function honest(s) {
  return '<section class="card cx-honest"><div class="section-title">The honest math</div><p class="small">JetX '
    + 'returns about 97%, so a round reaches ' + mult(s.target) + ' with about ' + pct(s.baseline) + ' chance, '
    + 'whatever came before. A bet at ' + mult(s.target) + ' needs ' + pct(s.break_even) + ' just to break even. '
    + esc(s.expectation_note) + '</p><p class="tiny muted">Every rule below is chosen on earlier rounds and judged '
    + 'only on later ones it never saw. No pattern beats a fair crash game; expect WAIT.</p></section>';
}

function hitCard(s) {
  var h = s.hit_rate;
  var read = !h.rounds ? 'No rounds yet.' : h.above === true ? 'Above the baseline: check the collector first, '
    + 'missed low rounds inflate this.' : h.above === false ? 'Below the baseline over this many rounds.'
    : 'Within the normal range of the baseline.';
  return '<section class="card"><div class="section-title">Hit rate at ' + mult(s.target) + '</div>'
    + '<div class="grid cols-3">' + stat(h.rounds ? pct(h.rate) : '—', 'Measured (' + h.rounds + ' rounds)')
    + stat(pct(s.baseline), 'Baseline', 'cx-hl') + stat(pct(s.break_even), 'Break-even') + '</div>'
    + '<p class="small">95% range ' + range(h) + '. ' + esc(read) + '</p>'
    + '<div class="grid cols-2">' + s.windows.map(function (w) {
      return stat(w.hit_rate ? pct(w.hit_rate.rate) : '—', 'Last ' + w.last + (w.hit_rate ? ' (' + range(w.hit_rate)
        + ')' : ' (not enough yet)'));
    }).join('') + '</div><p class="tiny muted">Median round ' + (s.median == null ? '—' : mult(s.median))
    + '. Short windows swing a lot by chance.</p></section>';
}

function streakCard(s) {
  var k = s.streaks, cur = k.current;
  return '<section class="card"><div class="section-title">Streaks</div><div class="grid cols-3">'
    + stat(cur ? cur.length + ' ' + cur.kind : '—', 'Current')
    + stat(k.longest_below + (k.typical_longest_below != null ? ' <small>(typical ' + k.typical_longest_below
      + ')</small>' : ''), 'Longest below')
    + stat(k.longest_above + (k.typical_longest_above != null ? ' <small>(typical ' + k.typical_longest_above
      + ')</small>' : ''), 'Longest above')
    + '</div><p class="tiny muted">' + esc(k.note) + '</p></section>';
}

function distCard(s) {
  var d = s.distribution, r = s.runs;
  return '<section class="card"><div class="section-title">Distribution vs expected</div><div class="cx-table-wrap">'
    + '<table class="cx-table"><thead><tr><th>Range</th><th>Rounds</th><th>Share</th><th>Expected</th></tr></thead>'
    + '<tbody>' + d.buckets.map(function (b) {
      return '<tr><td>' + esc(b.label) + '</td><td>' + b.count + '</td><td>' + pct(b.share) + '</td><td>'
        + pct(b.expected_share) + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="small">' + esc(d.read)
    + (d.p != null ? ' <span class="tiny muted">(chi-square ' + d.chi2 + ', ' + d.df + ' df, p = ' + d.p + ')</span>'
      : '') + '</p><p class="small"><b>Independence.</b> ' + esc(r.read)
    + (r.p != null ? ' <span class="tiny muted">(runs ' + r.runs + ' vs ' + r.expected + ' expected, p = ' + r.p
      + ')</span>' : '') + '</p></section>';
}

function stratCard(st) {
  return '<section class="card"><div class="section-title">Rules tested on unseen rounds</div><p class="tiny muted">'
    + esc(st.method) + '</p><div class="cx-table-wrap"><table class="cx-table"><thead><tr><th>Rule</th><th>Bets</th>'
    + '<th>Hit rate</th><th>95% range</th><th>Cautious low</th><th>ROI</th><th>Beats break-even</th></tr></thead>'
    + '<tbody>' + st.rows.map(function (r) {
      var t = r.test, chosen = r.id === st.selected;
      return '<tr' + (chosen ? ' class="cx-chosen"' : '') + '><td><b>' + esc(r.name) + '</b>' + (chosen
        ? ' <span class="badge">Chosen</span>' : '') + (r.condition_now ? ' <span class="badge ok">Now</span>' : '')
        + '<div class="tiny muted">' + esc(r.rule) + '</div></td><td>' + t.bets + '</td><td>' + pct(t.rate)
        + '</td><td>' + range(t) + '</td><td>' + pct(t.corrected_low) + '</td><td class="'
        + (t.roi > 0 ? 'cx-up' : t.roi < 0 ? 'cx-down' : '') + '">' + signedPct(t.roi) + '</td><td>'
        + (r.beats_break_even ? 'Yes' : 'No') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="tiny muted">Bets and hits count only the later ' + st.test_rounds
    + ' rounds. “Cautious low” is the lower end of the range after correcting for ' + st.tests + ' rules tested '
    + 'at once; a rule needs it above ' + pct(st.break_even) + ' and at least 100 unseen bets before Colon says BET. '
    + '“Now”: the rule’s condition is true for the next round. “Chosen”: the best rule on the earlier rounds.'
    + '</p></section>';
}

function render(box, a) {
  var s = a.stats;
  box.innerHTML = verdictCard(a.verdict) + honest(s)
    + '<p class="tiny muted">' + a.analysed + ' newest of ' + a.total_rounds + ' recorded rounds analysed.</p>'
    + hitCard(s) + streakCard(s) + distCard(s) + stratCard(a.strategies);
}

function analysisPage(view) {
  view.innerHTML = head('Analysis', 'Your JetX rounds against the published odds') + '<div id="cx-an">' + skel(4)
    + '</div>';
  var box = $('#cx-an', view), stop = false;
  var load = function () {
    crashApi.analysis().then(function (a) { if (!stop) render(box, a); }).catch(function (e) {
      if (!stop) fail(box, e); });
  };
  load();
  var timer = setInterval(function () { if (!document.hidden) load(); }, 60000);
  return function () { stop = true; clearInterval(timer); };
}

export { analysisPage };
