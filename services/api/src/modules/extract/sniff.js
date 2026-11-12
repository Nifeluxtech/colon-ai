// Real file type from the first bytes (never the extension or browser type alone), and upload validation.
const { MB, KINDS, fail } = require('./common');

const TEXT_EXT = /\.(txt|md|csv|json|xml|ya?ml|js|ts|py|java|c|cpp|cs|go|rs|php|sql|html|css|sh|log)$/i;
const DOC_EXT = /\.(docx?|odt|rtf|pptx?|xlsx?)$/i;

// Detects the real type from the file's first bytes (never trusts the extension or browser type alone).
function sniff(buf, name = '') {
  const b = buf;
  const ascii = (s, at = 0) => b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s;
  if (b.length >= 8 && b[0] === 0x89 && ascii('PNG', 1)) return { kind: 'image', mime: 'image/png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii('GIF87a') || ascii('GIF89a')) return { kind: 'image', mime: 'image/gif' };
  if (ascii('RIFF') && ascii('WEBP', 8)) return { kind: 'image', mime: 'image/webp' };
  if (ascii('%PDF-')) return { kind: 'pdf', mime: 'application/pdf' };
  if (ascii('{\\rtf')) return { kind: 'doc', mime: 'application/rtf', format: 'rtf' };
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const ext = (name.match(/\.(\w+)$/) || [])[1];
    const map = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        odt: 'application/vnd.oasis.opendocument.text' };
    if (ext && map[ext.toLowerCase()]) return { kind: 'doc', mime: map[ext.toLowerCase()], format: ext.toLowerCase() };
    return null; // some other ZIP: not accepted
  }
  if (b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1) {
    const ext = ((name.match(/\.(\w+)$/) || [])[1] || '').toLowerCase();
    const map = { doc: 'application/msword', ppt: 'application/vnd.ms-powerpoint', xls: 'application/vnd.ms-excel' };
    return map[ext] ? { kind: 'doc', mime: map[ext], format: ext } : null;
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return { kind: 'audio', mime: 'audio/webm' };
  if (ascii('OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii('RIFF') && ascii('WAVE', 8)) return { kind: 'audio', mime: 'audio/wav' };
  if (ascii('ID3') || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && /\.mp3$/i.test(name))) return {
    kind: 'audio', mime: 'audio/mpeg' };
  if (ascii('ftyp', 4) && /\.(m4a|mp4)$/i.test(name)) return { kind: 'audio', mime: 'audio/mp4' };
  // Text: no NUL bytes in the first 8 KB and valid UTF-8.
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return null;
  if (TEXT_EXT.test(name) || !/\.\w+$/.test(name) || /^text\//.test(name)) {
    const t = new TextDecoder('utf-8', { fatal: false }).decode(head);
    const bad = (t.match(/\uFFFD/g) || []).length;
    if (bad > Math.max(4, t.length * 0.01)) return null;
    return { kind: 'text', mime: mimeForText(name) };
  }
  return null;
}

function mimeForText(name) {
  const ext = ((name.match(/\.(\w+)$/) || [])[1] || '').toLowerCase();
  return { json: 'application/json', xml: 'application/xml', csv: 'text/csv', md: 'text/markdown', html: 'text/plain',
    js: 'text/plain', svg: 'text/plain' }[ext] || 'text/plain';
}

function validate(buf, name, { fromRecorder = false } = {}) {
  if (!buf.length) fail(`“${name}” is empty.`, 'empty');
  const s = sniff(buf, name);
  if (!s || (s.kind === 'audio' && !fromRecorder) || (s.kind === 'doc' && !DOC_EXT.test(name) && s.format !== 'rtf')) {
    fail((`“${name}” isn’t a supported file, or its contents don’t match its type. Use images, PDFs, documents or `
      + `text files.`));
  }
  const k = KINDS[s.kind];
  if (buf.length > k.max) fail(`“${name}” is ${(buf.length / MB).toFixed(
    1)} MB. ${k.label}s can be up to ${k.max / MB} MB.`, 'too_large');
  return s;
}

module.exports = { sniff, validate, mimeForText };
