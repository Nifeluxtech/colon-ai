/* Colon AI · Saga's extract (0.11.0): pulls a table or a list out of the page Saga drives, for the chat (a table
   and a CSV the user can download). Injected by SagaTools.run like tools.js: one function expression called with
   { what: 'table' | 'list', index }, returning a JSON string; nothing stays on window. index 0 is the biggest table
   (or list) on the page, 1 the next, and so on. Only visible text is read; form fields, passwords and hidden
   elements never are. At most 200 rows of 12 cells of 200 characters. The server cleans everything again. */
(function (args) {
  'use strict';
  var MAX_ROWS = 200, MAX_COLS = 12, MAX_CELL = 200, doc = document;
  function clip(s) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > MAX_CELL
    ? s.slice(0, MAX_CELL) : s; }
  function shown(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect(), st = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  }
  function text(el) {
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('input,textarea,select,script,style,noscript,[hidden]'),
      function (x) { x.remove(); });
    return clip(c.textContent);
  }
  function fromTable(t) {
    var rows = [], columns = [];
    var trs = t.querySelectorAll('tr');
    for (var i = 0; i < trs.length && rows.length < MAX_ROWS + 1; i++) {
      var cells = trs[i].querySelectorAll('th,td');
      if (!cells.length) continue;
      var row = [];
      for (var j = 0; j < cells.length && row.length < MAX_COLS; j++) row.push(text(cells[j]));
      var head = !columns.length && !rows.length && trs[i].querySelectorAll('th').length === cells.length;
      if (head) columns = row; else if (row.some(Boolean)) rows.push(row);
    }
    var cap = t.querySelector('caption');
    return { what: 'table', columns: columns, rows: rows.slice(0, MAX_ROWS), total: rows.length,
      caption: cap ? clip(cap.textContent) : '' };
  }
  function fromList(l) {
    var items = [];
    var lis = l.children;
    for (var i = 0; i < lis.length && items.length < MAX_ROWS; i++) {
      if (!shown(lis[i])) continue;
      var links = lis[i].querySelectorAll('a[href]'), t = text(lis[i]);
      if (!t) continue;
      items.push(links.length ? [t, clip(links[0].href)] : [t]);
    }
    var wide = items.some(function (r) { return r.length > 1; });
    return { what: 'list', columns: wide ? ['Item', 'Link'] : ['Item'], rows: items.map(function (r) {
      return wide && r.length < 2 ? [r[0], ''] : r; }), total: items.length, caption: '' };
  }
  // Repeated cards (search results, task lists) when a page has no <ul>/<ol>: the parent with the most children
  // sharing one class name.
  function cards() {
    var best = null, bestN = 2;
    Array.prototype.forEach.call(doc.querySelectorAll('main *, body > * *'), function (p) {
      if (p.children.length <= bestN || !shown(p)) return;
      var counts = {};
      for (var i = 0; i < p.children.length; i++) {
        var c = p.children[i].className;
        if (typeof c === 'string' && c) counts[c] = (counts[c] || 0) + 1;
      }
      for (var k in counts) if (counts[k] > bestN) { bestN = counts[k]; best = p; }
    });
    return best;
  }
  var index = Math.max(0, Math.min(20, Number(args && args.index) || 0));
  var what = args && args.what === 'list' ? 'list' : 'table';
  var pool = Array.prototype.filter.call(doc.querySelectorAll(what === 'table' ? 'table' : 'ul,ol'), shown)
    .map(function (el) { return { el: el, n: el.querySelectorAll(what === 'table' ? 'tr' : 'li').length }; })
    .filter(function (x) { return x.n > 1; }).sort(function (a, b) { return b.n - a.n; });
  var out;
  if (pool[index]) out = what === 'table' ? fromTable(pool[index].el) : fromList(pool[index].el);
  else if (what === 'table' && !pool.length) {
    var lists = Array.prototype.filter.call(doc.querySelectorAll('ul,ol'), shown);
    out = lists.length ? fromList(lists.sort(function (a, b) { return b.children.length - a.children.length; })[0])
      : null;
  }
  if (!out || !out.rows.length) { var c = cards(); out = c ? fromList(c) : null; }
  if (!out) return JSON.stringify({ what: what, columns: [], rows: [], total: 0, url: String(location.href) });
  out.url = String(location.href);
  out.title = clip(doc.title);
  return JSON.stringify(out);
})
