// Office Open XML and ODF documents (DOCX, PPTX, XLSX, ODT): read the ZIP container, then the XML parts.
const { MB, fail, decodeEntities, stripXml } = require('./common');
const zip = require('./zip');

/* ---------- ZIP (Office/ODF containers): read through the shared safe reader (zip.js) ---------- */
function unzip(buf, want) {
  const out = {};
  let total = 0;
  for (const e of zip.entries(buf)) {
    if (e.dir || !want(e.name)) continue;
    const file = zip.read(buf, e, 64 * MB);
    if (!file) continue;
    total += file.length;
    if (total > 128 * MB) fail('This document is too large to read.', 'processing'); // zip-bomb guard
    out[e.name] = file.toString('utf8');
  }
  return out;
}

function docxText(files) {
  const xml = files['word/document.xml'] || '';
  return stripXml(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n'));
}
function pptxText(files) {
  return Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((n, i) => `Slide ${i + 1}:\n` + stripXml(files[n].replace(/<\/a:p>/g, '\n'))).join('\n\n');
}
function xlsxText(files) {
  const shared = [];
  const ss = files['xl/sharedStrings.xml'] || '';
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(stripXml(m[1]));
  const sheets = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  return sheets.map((n, i) => {
    const rows = [];
    for (const r of files[n].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], inner = c[2] || '';
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const is = (inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1];
        if (/t="s"/.test(attrs) && v !== undefined) cells.push(shared[Number(v)] || '');
        else if (is) cells.push(stripXml(is));
        else cells.push(v !== undefined ? decodeEntities(v) : '');
      }
      rows.push(cells.join('\t'));
    }
    return `Sheet ${i + 1}:\n` + rows.join('\n');
  }).join('\n\n');
}
function odtText(files) {
  return stripXml((files['content.xml'] || '').replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g,
    '\n').replace(/<\/text:(p|h)>/g, '\n'));
}

module.exports = { unzip, docxText, pptxText, xlsxText, odtText };
