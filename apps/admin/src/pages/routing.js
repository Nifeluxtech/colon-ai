/* Colon Admin · Routing: which model answers each mode, in order. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { act } from '../components/form.js';
import { fail, head, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Routing ================= */
function routing(view) {
  gate(view, function () {
    view.innerHTML = head('Routing',
      'The order of model slots per mode. The first one that answers wins; the rest are fallbacks.') + '<div id="rt">'
      + skel(4) + '</div>';
    C.api('/admin/routing').then(function (d) {
      var routes = JSON.parse(JSON.stringify(d.routes)), hedge = d.hedge, slots = Object.keys(d.targets);
      var order = ['general', 'study', 'developer', 'research', 'african'];
      function slotInfo(n) { var t = d.targets[n] || []; return t.length ? t.map(function (x) { return (x.live
        ? '' : '⚠ ') + x.model; }).join(', ') : 'no models'; }
      function draw() {
        $('#rt', view).innerHTML = '<p class="tiny muted">Source: ' + esc(d.source)
          + ' · changes reach every server within ' + d.cache_seconds + ' s.</p>' +
          order.map(function (mode) {
            var list = routes[mode] || [];
            return '<div class="card adm-route"><div class="adm-slot-h"><b>' + esc(d.labels[mode] || mode)
              + '</b></div>' + list.map(function (n, i) {
              return '<div class="adm-rrow"><span class="adm-n">' + (i + 1) + '</span><span class="body"><b>' + esc(n)
                + '</b><div class="tiny muted">' + esc(slotInfo(n)) + '</div></span>' +
                '<button class="icon-btn sm" data-up="' + mode + ':' + i + '" aria-label="Move up"' + (i
                  ? '' : ' disabled') + '>' + icon('chevDown', 'flip') + '</button>' +
                '<button class="icon-btn sm" data-down="' + mode + ':' + i + '" aria-label="Move down"'
                  + (i < list.length - 1 ? '' : ' disabled') + '>' + icon('chevDown') + '</button>' +
                '<button class="icon-btn sm" data-rm="' + mode + ':' + i + '" aria-label="Remove"' + (list.length > 1
                  ? '' : ' disabled') + '>' + icon('x') + '</button></div>';
            }).join('') +
              (slots.filter(function (s) { return list.indexOf(s) < 0;
                }).length ? '<select class="select adm-add" data-add="' + mode
                + '" aria-label="Add a fallback"><option value="">+ Add fallback…</option>' + slots.filter(function (
                s) { return list.indexOf(s) < 0; }).map(function (s) { return '<option value="' + esc(s) + '">'
                + esc(s) + '</option>'; }).join('') + '</select>' : '') + '</div>';
          }).join('') +
          ('<div class="card"><div class="adm-slot-h"><b>Models asked at once (hedge)</b></div><p class="small '
            + 'muted">Saga asks this many models together and streams the first to answer. 1 = one after '
            + 'another.</p><div class="seg block">') +
          [1, 2, 3, 4].map(function (n) { return '<button type="button" data-h="' + n + '" aria-pressed="'
            + (n === hedge) + '">' + n + '</button>'; }).join('') + '</div></div>' +
          '<button class="btn primary block" data-save>Save routing</button>' + (d.saved
            ? '<button class="btn ghost block" data-reset>Reset to server defaults</button>' : '');
        function at(attr, fn) { $$('[' + attr + ']', view).forEach(function (b) { b.addEventListener('click',
          function () { var p = b.getAttribute(attr).split(':'); fn(routes[p[0]], Number(p[1])); draw(); }); }); }
        at('data-up', function (l, i) { l.splice(i - 1, 0, l.splice(i, 1)[0]); });
        at('data-down', function (l, i) { l.splice(i + 1, 0, l.splice(i, 1)[0]); });
        at('data-rm', function (l, i) { l.splice(i, 1); });
        $$('[data-add]', view).forEach(function (s) { s.addEventListener('change', function () { if (s.value) { routes[
          s.getAttribute('data-add')].push(s.value); draw(); } }); });
        $$('[data-h]', view).forEach(function (b) { b.addEventListener('click', function () { hedge = Number(
          b.getAttribute('data-h')); draw(); }); });
        $('[data-save]', view).addEventListener('click', function (e) {
          var b = e.currentTarget; b.disabled = true;
          act(C.api('/admin/routing', { method: 'PATCH', body: { routes: routes, hedge: hedge } }), function () {
            C.toast('Routing saved. Live within 30 s.', 'ok'); routing(view); }).catch(function () { b.disabled =
            false; });
        });
        var rs = $('[data-reset]', view);
        if (rs) rs.addEventListener('click', function () { C.confirm({ title: 'Reset routing?',
          body: 'Every mode goes back to the order built into the server.', confirm: 'Reset' }).then(function (ok) {
          if (ok) act(C.api('/admin/routing', { method: 'DELETE' }), function () { C.toast('Routing reset.');
          routing(view); }); }); });
      }
      draw();
    }).catch(function (e) { fail($('#rt', view), e); });
  });
}

export { routing };
