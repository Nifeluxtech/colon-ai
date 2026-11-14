// 0.11.0: Saga's extracted tables in the chat (apps/chat/src/lib/table-csv.js): markdown and a safe CSV.
const test = require('node:test');
const assert = require('node:assert/strict');
const { csvName, csvOf, markdownTable, rowsFromTable } = require('../../../apps/chat/src/lib/table-csv.js');

test('markdown table: header made up when missing, pipes escaped, short rows padded', () => {
  assert.equal(markdownTable(['Name', 'Price'], [['Rice', '₦5|000'], ['Beans']]),
    '| Name | Price |\n| --- | --- |\n| Rice | ₦5\\|000 |\n| Beans |  |');
  assert.equal(markdownTable([], [['a', 'b']]).split('\n')[0], '| Column 1 | Column 2 |');
  assert.equal(markdownTable([], [['a']]).split('\n')[0], '| Item |');
  assert.equal(markdownTable([], []), '');
});

test('CSV: quoting, BOM, CRLF and formula injection guarded', () => {
  const csv = csvOf(['Item', 'Note'], [['=SUM(A1)', 'a, "b"'], ['+2', '@x'], ['plain', ' padded']]);
  assert.ok(csv.startsWith('\ufeffItem,Note\r\n'));
  assert.ok(csv.includes('\'=SUM(A1),"a, ""b"""\r\n'));
  assert.ok(csv.includes('\'+2,\'@x\r\n'));
  assert.ok(csv.endsWith('plain," padded"\r\n'));
});

test('rows from a rendered table and the file name', () => {
  const cell = (t) => ({ textContent: ' ' + t + ' ' });
  const tr = (tag, cells) => ({ querySelectorAll: (q) => (q === 'th' ? (tag === 'th' ? cells : []) : cells) });
  const table = { querySelectorAll: () => [tr('th', [cell('A'), cell('B')]), tr('td', [cell('1'), cell('2')])] };
  assert.deepEqual(rowsFromTable(table), { columns: ['A', 'B'], rows: [['1', '2']] });
  assert.deepEqual(rowsFromTable(null), { columns: [], rows: [] });
  assert.equal(csvName('Data from Jumia.com.ng!', new Date('2026-11-14T10:00:00Z')),
    'colon-data-from-jumia-com-ng-2026-11-14.csv');
});
