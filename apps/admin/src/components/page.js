/* Colon Admin · page building blocks: headers, skeletons, error cards, numbers, chips, status dots. */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

function head(title, lead, action) {
  return '<div class="adm-head"><div><h1 class="h1">' + esc(title) + '</h1>' + (lead ? '<p class="lead">' + esc(lead)
    + '</p>' : '') + '</div>' + (action || '') + '</div>';
}
function skel(n) { var s = ''; for (var i = 0; i < (n || 3);
  i++) s += '<div class="skel" style="height:44px;margin-top:' + (i ? 12 : 0) + 'px"></div>';
  return '<div style="padding:16px">' + s + '</div>'; }
function fail(el, e) { el.innerHTML = '<div class="card empty">' + icon('alert') + '<p>' + esc(e.message)
  + '</p></div>'; }
function num(n) { return Number(n || 0).toLocaleString(); }
function chips(items, current, attr) {
  return '<div class="chips adm-chips" role="tablist">' + items.map(function (it) {
    return '<button type="button" class="chip sm' + (it[0] === current ? ' on' : '') + '" ' + attr + '="' + it[0]
    + '" aria-pressed="' + (it[0] === current) + '">' + esc(it[1]) + '</button>'; }).join('') + '</div>';
}
function dot(pct) { return '<span class="status-dot' + (pct == null ? ' warn' : pct >= 90 ? '' : pct >= 50
  ? ' warn' : ' bad') + '"></span>'; }

export { chips, dot, fail, head, num, skel };
