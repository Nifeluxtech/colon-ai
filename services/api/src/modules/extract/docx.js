// Office Open XML and ODF documents (DOCX, PPTX, XLSX, ODT): read the ZIP container, then the XML parts.
const zlib = require('zlib');
const { MB, fail, decodeEntities, stripXml } = require('./common');

/* ---------- ZIP (Office/ODF containers) ---------- */
function unzip(buf, want) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) fail('This document looks damaged (no ZIP directory).', 'processing');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const lnameLen = buf.readUInt16LE(local + 26), lextra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnameLen + lextra;
    const data = buf.subarray(start, start + csize);
    let file;
    if (method === 0) file = data;
    else if (method === 8) file = zlib.inflateRawSync(data, { maxOutputLength: 64 * MB });
    else continue;
    total += file.length;
    if (total > 128 * MB) fail('This document is too large to read.', 'processing'); // zip-bomb guard
    out[name] = file.toString('utf8');
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
  return stripXml((files['content.xml'] || '').replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<\/text:(p|h)>/g, '\n'));
}

module.exports = { unzip, docxText, pptxText, xlsxText, odtText };
