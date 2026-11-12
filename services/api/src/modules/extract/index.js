// File checks and text extraction for chat uploads, with Node built-ins only (zlib for PDF streams and
// Office ZIP containers). Good enough for typed PDFs, DOCX/PPTX/XLSX/ODT, RTF and text. Scanned PDFs
// (images of pages) have no text layer: we say so instead of guessing.
const { KINDS, MAX_TEXT } = require('./common');
const { sniff, validate } = require('./sniff');
const { imageSize } = require('./image');
const { unzip, docxText, pptxText, xlsxText, odtText } = require('./docx');
const { rtfText, oleText, tidy, readable } = require('./text');
const { pdfText } = require('./pdf');

/**
 * extract(buf, sniffed) -> { text, meta } ; text is '' when nothing readable was found (meta.note says why).
 */
function extract(buf, s) {
  const meta = {};
  let text = '';
  try {
    if (s.kind === 'text') {
      text = new TextDecoder('utf-8').decode(buf);
      meta.lines = text.split('\n').length;
    } else if (s.kind === 'image') {
      Object.assign(meta, imageSize(buf, s.mime));
    } else if (s.kind === 'pdf') {
      const r = pdfText(buf);
      meta.pages = r.pages || undefined;
      text = r.text;
    } else if (s.kind === 'doc') {
      if (s.format === 'rtf') text = rtfText(buf.toString('latin1'));
      else if (['doc', 'ppt', 'xls'].includes(s.format)) { text = oleText(buf); meta.approximate = true; }
      else {
        const files = unzip(buf, (n) => /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|content\.xml)$/.test(n));
        text = s.format === 'docx' ? docxText(files) : s.format === 'pptx' ? pptxText(files) : s.format === 'xlsx' ? xlsxText(files) : odtText(files);
      }
    }
  } catch (e) {
    if (e.code === 'processing') throw e;
    text = '';
    meta.note = 'The text couldn’t be read from this file.';
  }
  text = tidy(text);
  if (s.kind === 'pdf' || s.kind === 'doc') {
    if (!readable(text)) {
      text = '';
      meta.note = s.kind === 'pdf' ? 'No readable text layer (it may be a scanned PDF or use an unusual font encoding).' : 'No readable text found in this document.';
    }
  }
  if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); meta.truncated = true; }
  if (text) meta.words = (text.match(/\S+/g) || []).length;
  return { text, meta };
}

module.exports = { sniff, validate, extract, imageSize, unzip, pdfText, rtfText, KINDS, MAX_TEXT };
