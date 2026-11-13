/* Colon Admin · Evaluation: benchmark runs and feedback per model. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { act, area, opt, sel } from '../components/form.js';
import { fail, head, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Evaluation ================= */
function evaluation(view) {
  gate(view, function () {
    view.innerHTML = head('Evaluation',
      ('Colon benchmark runs (npm run bench) and what people think of each model. A model goes into routing only '
      + 'after a fresh benchmark.'), '<button class="btn sm" data-import>' + icon('upload')
      + 'Import benchmark</button> <button class="btn sm" data-add>' + icon('plus') + 'Add run</button>'
      + '<input type="file" accept=".json,application/json" data-file hidden>')
      + '<div id="ev">' + skel(3) + '</div>';
    function load() {
      C.api('/admin/evaluation').then(function (d) {
        $('#ev', view).innerHTML = '<div class="section-title">Benchmark runs</div><div class="list">' + (d.runs.length
          ? d.runs.map(function (r) {
          return '<div class="row"><span class="ico">' + icon('target')
            + '</span><span class="body"><div class="title">' + esc(r.name) + (r.score != null ? ' · <b>' + r.score
            + '</b>' : '') + '</div><div class="sub">' + (r.kind === 'bench'
            ? '<span class="badge">benchmark</span> ' : '') + esc((r.provider ? r.provider + ':' : '') + (r.model
            || 'any model')) + ' · ' + esc(r.status) + ' · ' + C.ago(r.created_at) + (r.notes ? ' · '
            + esc(r.notes) : '') + '</div></span><button class="icon-btn sm" data-del="' + r.id
            + '" aria-label="Delete run">' + icon('trash') + '</button></div>';
        }).join('') : '<div class="empty small">No runs yet. Log one with “Add run”.</div>') + '</div>' +
          '<div class="section-title">Feedback per model (30 days)</div>' + (d.feedback.length
            ? ('<div class="card adm-table-wrap"><table class="adm-table"><thead><tr><th>Model</th><th>👍</th><th>'
            + '👎</th><th>Positive</th></tr></thead><tbody>') + d.feedback.map(function (f) {
            var tot = f.up + f.down, pct = tot ? Math.round(f.up / tot * 100) : 0;
            return '<tr><td><b>' + esc(f.model || 'unknown') + '</b><div class="tiny muted">' + esc(f.provider || '—')
              + '</div></td><td>' + f.up + '</td><td>' + f.down + '</td><td><div class="progress"><i style="width:'
              + pct + '%"></i></div><span class="tiny">' + pct + '%</span></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty small">No feedback yet.</div>') +
          (d.reasons.length ? '<div class="section-title">Why replies were rated bad</div><div class="chips">'
            + d.reasons.map(function (x) { return '<span class="badge">' + esc(x.reason) + ' · ' + x.n + '</span>';
            }).join('') + '</div>' : '');
        $$('[data-del]', view).forEach(function (b) { b.addEventListener('click', function () { C.confirm({
          title: 'Delete this run?', confirm: 'Delete', danger: true }).then(function (ok) { if (ok) act(C.api(
          '/admin/evaluation/runs/' + b.getAttribute('data-del'), { method: 'DELETE' }), load); }); }); });
      }).catch(function (e) { fail($('#ev', view), e); });
    }
    // Import benchmark: bench/results/<run>.eval.json -> POST /admin/evaluation/bench (also re-derives specialists).
    var file = $('[data-file]', view);
    $('[data-import]', view).addEventListener('click', function () { file.value = ''; file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      f.text().then(function (t) {
        var runs = null;
        try { var j = JSON.parse(t); runs = Array.isArray(j) ? j : j.runs; } catch (e) { runs = null; }
        if (!Array.isArray(runs) || !runs.length) { C.toast('Pick a bench/results/<run>.eval.json file.', 'bad');
          return; }
        act(C.api('/admin/evaluation/bench', { method: 'POST', body: { runs: runs } }), function (r) {
          C.toast('Imported ' + r.ids.length + ' benchmark runs. Routing updates within 30 s.', 'ok'); load();
        }).catch(function () {});
      });
    });
    $('[data-add]', view).addEventListener('click', function () {
      C.sheet('<div class="h2">Log a benchmark run</div><form class="form" novalidate>' + C.field({ name: 'name',
        label: 'Name', placeholder: 'e.g. WAEC maths set v1' }) + opt('model', 'Model', '', 'e.g. gemma-4-26b-a4b-it') +
        sel('status', 'Status', 'planned', [['planned', 'Planned'], ['running', 'Running'], ['done', 'Done'],
          ['failed', 'Failed']]) + opt('score', 'Score (0–100)', '', '', 'number') + area('notes', 'Notes') +
        ('<button class="btn primary block" type="submit">Save</button><button class="btn ghost block" '
          + 'type="button" data-close>Cancel</button></form>'), function (el, close) {
        C.bindForm($('form', el), function (f) { return C.api('/admin/evaluation/runs', { method: 'POST',
          body: f }).then(function () { close(); load(); }); });
      });
    });
    load();
  });
}

export { evaluation };
