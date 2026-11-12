// Shared limits and helpers for upload checks and text extraction.
const MB = 1048576;
const KINDS = {
  image: { max: 10 * MB, label: 'Image' },
  pdf: { max: 20 * MB, label: 'PDF' },
  doc: { max: 20 * MB, label: 'Document' },
  text: { max: 2 * MB, label: 'Text file' },
  audio: { max: 10 * MB, label: 'Voice note' },
};
const MAX_TEXT = 120000; // characters of extracted text kept per file

const fail = (message, code = 'unsupported') => { throw Object.assign(new Error(message), { status: 422, code }); };

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
  .replace(/&amp;/g, '&');
function safeChar(n) { try { return String.fromCodePoint(n); } catch { return ''; } }
const stripXml = (s) => decodeEntities(s.replace(/<[^>]+>/g, ''));

module.exports = { MB, KINDS, MAX_TEXT, fail, decodeEntities, safeChar, stripXml };
