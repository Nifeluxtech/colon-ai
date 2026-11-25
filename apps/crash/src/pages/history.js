/* Colon JetX · History: the latest 100 rounds (green when they reached the target) and the latest 100 bets, plus
   adding rounds by hand or from a CSV (v0.35.0). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { betRows, fail, head, roundChips, skel } from '../components/cards.js';
import { bindImporter, importerHtml } from '../components/importer.js';
import { crashApi } from '../core/api.js';
import { mult } from '../core/state.js';

var C = Colon, $ = C.$;

function history(view) {
  view.innerHTML = head('History', 'Recorded JetX rounds and your bets') + '<div id="cx-hist">' + skel(3) + '</div>';
  var box = $('#cx-hist', view);
  function lists() {
    return Promise.all([crashApi.settings(), crashApi.rounds(100), crashApi.bets(100)]).then(function (r) {
      var s = r[0].settings;
      $('#cx-lists', box).innerHTML = '<section class="card"><div class="section-title">Rounds (' + r[1].rounds.length
        + ')</div>' + roundChips(r[1].rounds, s.target_cashout) + '<p class="tiny muted">Green: reached '
        + mult(s.target_cashout) + '. Newest first.</p></section><section class="card"><div class="section-title">'
        + 'Bets (' + r[2].bets.length + ')</div>' + betRows(r[2].bets, s.currency) + '</section>';
    });
  }
  box.innerHTML = '<div id="cx-lists" class="cx-stack">' + skel(2) + '</div>' + importerHtml();
  bindImporter(box, function () { lists().catch(function (e) { C.toast(e.message, 'bad'); }); });
  lists().catch(function (e) { fail($('#cx-lists', box), e); });
}

export { history };
