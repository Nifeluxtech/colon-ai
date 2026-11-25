/* Colon JetX · adding rounds by hand (v0.35.0, Crash Predictor step 3): one round typed in, or a CSV pasted or
   chosen from the phone. The API cleans and dedupes both (POST /crash/rounds, /crash/rounds/import) and answers how
   many were added, already there (duplicates) or refused, with the first refused rows. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { crashApi } from '../core/api.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$;
var REASON = { bad_multiplier: 'not a multiplier from 1.00 to 1,000,000 with up to 2 decimals',
  bad_time: 'the time can’t be read or is in the future', bad_round_id: 'the round id has odd characters',
  not_a_round: 'not a round' };
var MAX_FILE = 400 * 1024;

function resultLine(r) {
  var bits = [r.inserted + ' added', r.duplicates + ' already there', r.rejected + ' refused'];
  var errs = (r.errors || []).slice(0, 5).map(function (e) {
    return '<li>' + (e.line != null ? 'Line ' + e.line : 'Round ' + (Number(e.index) + 1)) + ': '
      + esc(REASON[e.reason] || e.reason) + '</li>';
  }).join('');
  return '<p class="small"><span class="status-dot' + (r.rejected ? ' warn' : '') + '"></span> ' + esc(bits.join(' · '))
    + (r.rows != null ? ' (' + r.rows + ' rows read)' : '') + '</p>' + (errs ? '<ul class="tiny muted">' + errs
    + '</ul>' : '');
}

function importerHtml() {
  return '<section class="card"><div class="section-title">Add a round</div><form class="cx-form" id="cx-add" '
    + 'novalidate>' + C.field({ name: 'multiplier', label: 'Multiplier (x)', placeholder: '1.53', mode: 'decimal',
      auto: 'off' })
    + C.field({ name: 'round_id', label: 'Round id (if the game shows one)', required: false, auto: 'off', max: 64 })
    + '<button class="btn primary block" type="submit">' + icon('plus') + 'Add round</button></form>'
    + '<div id="cx-add-out"></div></section>'
    + '<section class="card"><div class="section-title">Import a CSV</div><form class="cx-form" id="cx-csv" novalidate>'
    + '<div class="field" data-field="csv"><label for="f-csv">Paste rows</label><textarea class="textarea" '
    + 'id="f-csv" name="csv" rows="5" placeholder="multiplier,time,round_id&#10;1.53,2026-11-25 20:14:05,8812345'
    + '&#10;2.10" spellcheck="false"></textarea><div class="msg"></div></div>'
    + '<div class="field"><label for="f-csv-file">Or choose a file</label><input class="input" id="f-csv-file" '
    + 'type="file" accept=".csv,.txt,text/csv,text/plain"></div>'
    + '<p class="tiny muted">Columns: multiplier, then time and round id if you have them (a header row in any order '
    + 'works too). Up to 5,000 rows. Rows already saved are skipped, so importing the same file twice is safe. Rows '
    + 'without a time get the import time.</p><button class="btn primary block" type="submit">' + icon('upload')
    + 'Import</button></form><div id="cx-csv-out"></div></section>';
}

// box: the element holding importerHtml(); done(): reload the rounds list after something was added.
function bindImporter(box, done) {
  var add = $('#cx-add', box), csv = $('#cx-csv', box), file = $('#f-csv-file', box);
  C.bindForm(add, function (data) {
    var m = String(data.multiplier || '').replace(/\s*[x×]$/i, '').replace(',', '.');
    var round = { multiplier: m };
    if (data.round_id) round.round_id = data.round_id;
    return crashApi.addRounds([round]).then(function (r) {
      $('#cx-add-out', box).innerHTML = resultLine(r);
      if (r.inserted) { add.reset(); done(); }
    });
  });
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    if (!f) return;
    if (f.size > MAX_FILE) { C.toast('That file is too big (400 KB at most).', 'bad'); file.value = ''; return; }
    f.text().then(function (t) { $('[name=csv]', csv).value = t; }).catch(function () {
      C.toast('Couldn’t read that file.', 'bad'); });
  });
  C.bindForm(csv, function (data) {
    return crashApi.importCsv(data.csv || '').then(function (r) {
      $('#cx-csv-out', box).innerHTML = resultLine(r);
      if (r.inserted) done();
    });
  });
}

export { bindImporter, importerHtml, resultLine };
