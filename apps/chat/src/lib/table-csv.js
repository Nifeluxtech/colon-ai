/* Colon AI · Saga's extracted tables in the chat (0.11.0): a markdown table for the thread and a CSV the user can
   download (from the table on screen, so it works after a reload too). Cells that a spreadsheet would run as a
   formula (= + - @, tab, CR) are prefixed with ' (CSV injection). Pure: unit-tested in packages/ui/test. */

function cellMd(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim(); }

/** columns (may be empty), rows -> a markdown table (a header is made up when there are no columns). */
function markdownTable(columns, rows) {
  var width = Math.max(columns.length, rows.reduce(function (n, r) { return Math.max(n, r.length); }, 0));
  if (!width) return '';
  var head = [];
  for (var i = 0; i < width; i++) head.push(cellMd(columns[i]) || (width === 1 ? 'Item' : 'Column ' + (i + 1)));
  var line = function (r) {
    var c = [];
    for (var j = 0; j < width; j++) c.push(cellMd(r[j]));
    return '| ' + c.join(' | ') + ' |';
  };
  return [line(head), '|' + head.map(function () { return ' --- '; }).join('|') + '|'].concat(rows.map(line))
    .join('\n');
}

function cellCsv(v) {
  var s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;
  return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** columns, rows -> CSV text (CRLF line ends, UTF-8 BOM for spreadsheet apps). */
function csvOf(columns, rows) {
  var lines = (columns && columns.length ? [columns] : []).concat(rows || []);
  return '\ufeff' + lines.map(function (r) { return r.map(cellCsv).join(','); }).join('\r\n') + '\r\n';
}

/** A rendered <table> -> { columns, rows } (th cells of the first row are the columns). */
function rowsFromTable(table) {
  var out = { columns: [], rows: [] };
  if (!table || !table.querySelectorAll) return out;
  var trs = table.querySelectorAll('tr');
  for (var i = 0; i < trs.length; i++) {
    var cells = trs[i].querySelectorAll('th,td'), row = [];
    for (var j = 0; j < cells.length; j++) row.push(String(cells[j].textContent || '').trim());
    if (i === 0 && trs[i].querySelectorAll('th').length) out.columns = row; else if (row.length) out.rows.push(row);
  }
  return out;
}

/** A file name for the CSV: "colon-<caption or site>-<date>.csv". */
function csvName(label, now) {
  var base = String(label || 'table').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  var d = (now || new Date()).toISOString().slice(0, 10);
  return 'colon-' + (base || 'table') + '-' + d + '.csv';
}

export { csvName, csvOf, markdownTable, rowsFromTable };
