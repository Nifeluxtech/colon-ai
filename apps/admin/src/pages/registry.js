/* Colon Admin · African AI registry. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { act, area, opt, sel } from '../components/form.js';
import { chips, fail, head, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= African AI registry ================= */
var REG_STATUS = [['candidate', 'Candidate'], ['approved', 'Approved'], ['in_use', 'In use'], ['rejected', 'Rejected']];
function registry(view) {
  gate(view, function () {
    var kind = '';
    view.innerHTML = head('African AI registry', 'Language models and datasets, with their licences.',
      '<button class="btn sm" data-add>' + icon('plus') + 'Add</button>') +
      chips([['', 'All'], ['model', 'Models'], ['dataset', 'Datasets']], '', 'data-k')
        + '<div class="list" id="rg" style="margin-top:12px"></div>';
    function load() {
      $('#rg', view).innerHTML = skel(3);
      C.api('/admin/registry?kind=' + kind).then(function (d) {
        $('#rg', view).innerHTML = d.entries.length ? d.entries.map(function (x) {
          return '<button class="row" data-id="' + x.id + '"><span class="ico">' + icon(x.kind === 'model'
            ? 'bot' : 'database') + '</span><span class="body"><div class="title">' + esc(x.name)
            + '</div><div class="sub">' + esc(x.languages || 'languages not set') + ' · ' + esc(x.licence
            || 'licence unknown') + '</div>' +
            '<div class="adm-badges"><span class="badge">' + esc(x.kind) + '</span><span class="badge '
              + (x.status === 'in_use' || x.status === 'approved' ? 'ok' : x.status === 'rejected' ? 'bad' : '') + '">'
              + esc((REG_STATUS.filter(function (s) { return s[0] === x.status; })[0] || [0, x.status])[1])
              + '</span><span class="badge ' + (x.commercial === 'yes' ? 'ok' : x.commercial === 'no' ? 'warn' : '')
              + '">Commercial use: ' + esc(x.commercial) + '</span></div></span><span class="chev">' + icon('chev')
              + '</span></button>';
        }).join('') :
          '<div class="empty">Nothing yet. Add N-ATLaS, NaijaVox and other African models and datasets here.</div>';
        $$('[data-id]', view).forEach(function (b) { b.addEventListener('click', function () { entry(d.entries.filter(
          function (x) { return String(x.id) === b.getAttribute('data-id'); })[0]); }); });
      }).catch(function (e) { fail($('#rg', view), e); });
    }
    function entry(x) {
      var isNew = !x; x = x || { kind: 'model', commercial: 'unknown', status: 'candidate' };
      C.sheet('<div class="h2">' + (isNew ? 'Add to registry' : esc(x.name)) + '</div><form class="form" novalidate>' +
        sel('kind', 'Type', x.kind, [['model', 'Language model'], ['dataset', 'Dataset']]) + C.field({ name: 'name',
          label: 'Name', value: x.name || '' }) +
        opt('languages', 'Languages', x.languages, 'e.g. Yorùbá, Hausa, Igbo, Naijá') + opt('licence', 'Licence',
          x.licence, 'e.g. Apache-2.0, CC BY 4.0') +
        opt('licence_url', 'Licence link', x.licence_url, 'https://…', 'url') + opt('source_url', 'Source link',
          x.source_url, 'https://…', 'url') +
        sel('commercial', 'Commercial use allowed?', x.commercial, [['unknown', 'Unknown'], ['yes', 'Yes'], ['no',
          'No']]) + sel('status', 'Status', x.status, REG_STATUS) + area('notes', 'Notes', x.notes) +
        '<button class="btn primary block" type="submit">Save</button>' + (isNew
          ? '' : '<button class="btn danger block" type="button" data-del>Delete</button>')
          + '<button class="btn ghost block" type="button" data-close>Close</button></form>', function (el, close) {
        C.bindForm($('form', el), function (f) { return C.api(isNew ? '/admin/registry' : '/admin/registry/' + x.id,
          { method: isNew ? 'POST' : 'PATCH', body: f }).then(function () { C.toast('Saved.', 'ok'); close(); load();
          }); });
        var del = $('[data-del]', el);
        if (del) del.addEventListener('click', function () { C.confirm({ title: 'Delete ' + x.name + '?',
          confirm: 'Delete', danger: true }).then(function (ok) { if (ok) act(C.api('/admin/registry/' + x.id,
          { method: 'DELETE' }), function () { close(); load(); }); }); });
      });
    }
    $$('[data-k]', view).forEach(function (b) { b.addEventListener('click', function () { kind = b.getAttribute(
      'data-k'); $$('[data-k]', view).forEach(function (y) { y.classList.toggle('on', y === b);
      y.setAttribute('aria-pressed', y === b); }); load(); }); });
    $('[data-add]', view).addEventListener('click', function () { entry(null); });
    load();
  });
}

export { registry };
