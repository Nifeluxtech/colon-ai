// File checks and text extraction for chat uploads, with Node built-ins only (zlib for PDF streams and
// Office ZIP containers). Good enough for typed PDFs, DOCX/PPTX/XLSX/ODT, RTF and text. Scanned PDFs
// (images of pages) have no text layer: we say so instead of guessing.
const zlib = require('zlib');

const MB = 1048576;
const KINDS = {
  image: { max: 10 * MB, label: 'Image' },
  pdf: { max: 20 * MB, label: 'PDF' },
  doc: { max: 20 * MB, label: 'Document' },
  text: { max: 2 * MB, label: 'Text file' },
  audio: { max: 10 * MB, label: 'Voice note' },
};
const MAX_TEXT = 120000; // characters of extracted text kept per file

const TEXT_EXT = /\.(txt|md|csv|json|xml|ya?ml|js|ts|py|java|c|cpp|cs|go|rs|php|sql|html|css|sh|log)$/i;
const DOC_EXT = /\.(docx?|odt|rtf|pptx?|xlsx?)$/i;

const fail = (message, code = 'unsupported') => { throw Object.assign(new Error(message), { status: 422, code }); };

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
    const map = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', odt: 'application/vnd.oasis.opendocument.text' };
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
  if (ascii('ID3') || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && /\.mp3$/i.test(name))) return { kind: 'audio', mime: 'audio/mpeg' };
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
  return { json: 'application/json', xml: 'application/xml', csv: 'text/csv', md: 'text/markdown', html: 'text/plain', js: 'text/plain', svg: 'text/plain' }[ext] || 'text/plain';
}

function validate(buf, name, { fromRecorder = false } = {}) {
  if (!buf.length) fail(`“${name}” is empty.`, 'empty');
  const s = sniff(buf, name);
  if (!s || (s.kind === 'audio' && !fromRecorder) || (s.kind === 'doc' && !DOC_EXT.test(name) && s.format !== 'rtf')) {
    fail(`“${name}” isn’t a supported file, or its contents don’t match its type. Use images, PDFs, documents or text files.`);
  }
  const k = KINDS[s.kind];
  if (buf.length > k.max) fail(`“${name}” is ${(buf.length / MB).toFixed(1)} MB. ${k.label}s can be up to ${k.max / MB} MB.`, 'too_large');
  return s;
}

/* ---------- Images: dimensions from headers ---------- */
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp') {
      const f = buf.toString('latin1', 12, 16);
      if (f === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (f === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (f === 'VP8L') { const v = buf.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return {};
}

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

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
  .replace(/&amp;/g, '&');
function safeChar(n) { try { return String.fromCodePoint(n); } catch { return ''; } }
const stripXml = (s) => decodeEntities(s.replace(/<[^>]+>/g, ''));

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

function rtfText(s) {
  return s
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => Buffer.from([parseInt(h, 16)]).toString('latin1'))
    .replace(/\\u(-?\d+)\??/g, (_, n) => safeChar(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\s*\}/g, '')
    .replace(/\\(par|line)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\\([\\{}])/g, '$1');
}

// Legacy binary Office files (.doc/.ppt/.xls): pull readable runs of UTF-16 and ASCII text. Approximate.
function oleText(buf) {
  const runs = [];
  const u16 = buf.toString('utf16le');
  for (const m of u16.matchAll(/[\p{L}\p{N}\p{P}\p{Zs}\n\r\t]{6,}/gu)) if (/[\p{L}]{3}/u.test(m[0])) runs.push(m[0]);
  if (runs.join('').length < 200) for (const m of buf.toString('latin1').matchAll(/[\x20-\x7e\n\r\t]{8,}/g)) if (/[a-z]{3}/i.test(m[0])) runs.push(m[0]);
  return runs.join('\n');
}

/* ---------- PDF ----------
   A small reader for text-based PDFs: objects (including compressed object streams), the page tree,
   each page's fonts and their ToUnicode maps (how real-world PDFs from Word, Google Docs and browsers
   store text), and the text-showing operators in each page's content streams. */
function pdfLiteralBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out.push(s.charCodeAt(i) & 0xff); continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') out.push(10); else if (n === 'r') out.push(13); else if (n === 't') out.push(9);
    else if (n === 'b') out.push(8); else if (n === 'f') out.push(12);
    else if (/[0-7]/.test(n)) { let oct = n; while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i]; out.push(parseInt(oct, 8) & 0xff); }
    else if (n === '\r') { if (s[i + 1] === '\n') i++; } else if (n === '\n') { /* line continuation */ } else out.push(n.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}
function hexBytes(h) { h = h.replace(/[^0-9a-fA-F]/g, ''); if (h.length % 2) h += '0'; return Buffer.from(h, 'hex'); }
const utf16be = (b) => { const c = Buffer.from(b); if (c.length % 2) return c.toString('latin1'); return c.swap16().toString('utf16le'); };

// Reads the value of /Key in a dictionary's text: a reference, name, number, array or nested dictionary.
function dictGet(text, key) {
  const re = new RegExp('/' + key + '(?![A-Za-z0-9])\\s*', 'g');
  let m, depth = 0;
  // Only accept a key at the top level of this dictionary.
  while ((m = re.exec(text))) {
    depth = 0;
    for (let i = 0; i < m.index; i++) {
      if (text[i] === '<' && text[i + 1] === '<') { depth++; i++; } else if (text[i] === '>' && text[i + 1] === '>') { depth--; i++; }
    }
    if (depth <= 1) break;
  }
  if (!m) return null;
  let i = re.lastIndex;
  const rest = text.slice(i);
  const ref = rest.match(/^(\d+)\s+(\d+)\s+R/);
  if (ref) return { ref: Number(ref[1]) };
  if (rest.startsWith('<<')) {
    let d = 0, j = 0;
    for (; j < rest.length; j++) {
      if (rest[j] === '<' && rest[j + 1] === '<') { d++; j++; } else if (rest[j] === '>' && rest[j + 1] === '>') { d--; j++; if (!d) break; }
    }
    return { dict: rest.slice(0, j + 1) };
  }
  if (rest[0] === '[') { let d = 0, j = 0; for (; j < rest.length; j++) { if (rest[j] === '[') d++; else if (rest[j] === ']' && !--d) break; } return { array: rest.slice(1, j) }; }
  const name = rest.match(/^\/([^\s/<>\[\]()]+)/);
  if (name) return { name: name[1] };
  const num = rest.match(/^-?\d+(\.\d+)?/);
  return num ? { num: Number(num[0]) } : null;
}
const refsIn = (arr) => [...String(arr).matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1]));

function inflate(data) {
  try { return zlib.inflateSync(data, { maxOutputLength: 16 * MB }); } catch {
    try { return zlib.inflateSync(data.subarray(0, data.length - 1), { maxOutputLength: 16 * MB }); } catch { return null; }
  }
}

function pdfObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const bodyStart = re.lastIndex;
    const st = s.indexOf('stream', bodyStart);
    const eo = s.indexOf('endobj', bodyStart);
    if (eo < 0) break;
    const o = { dict: s.slice(bodyStart, st > -1 && st < eo ? st : eo) };
    if (st > -1 && st < eo) {
      let ds = st + 6;
      if (s[ds] === '\r') ds++;
      if (s[ds] === '\n') ds++;
      const len = dictGet(o.dict, 'Length');
      let de = len && len.num !== undefined ? ds + len.num : -1;
      if (de < ds || s.slice(de, de + 20).indexOf('endstream') < 0) de = s.indexOf('endstream', ds);
      o.stream = buf.subarray(ds, de);
    }
    objs.set(num, o);
    re.lastIndex = eo + 6;
  }
  // Compressed object streams (PDF 1.5+) hold most dictionaries in modern files.
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const data = /\/FlateDecode/.test(o.dict) ? inflate(o.stream) : o.stream;
    if (!data) continue;
    const n = (dictGet(o.dict, 'N') || {}).num || 0, first = (dictGet(o.dict, 'First') || {}).num || 0;
    const t = data.toString('latin1');
    const nums = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const objNum = nums[2 * k], off = first + nums[2 * k + 1], next = k + 1 < n ? first + nums[2 * k + 3] : t.length;
      if (!objs.has(objNum)) objs.set(objNum, { dict: t.slice(off, next) });
    }
  }
  return objs;
}

function streamOf(objs, num) {
  const o = objs.get(num);
  if (!o || !o.stream) return null;
  if (/\/FlateDecode/.test(o.dict)) return inflate(o.stream);
  if (/\/Filter/.test(o.dict)) return null; // image or other filters: not text
  return o.stream;
}

function parseCMap(text) {
  const map = new Map();
  let bytes = 1;
  const cs = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  if (cs) bytes = Math.max(1, Math.round(cs[1].length / 2));
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(parseInt(p[1], 16), utf16be(hexBytes(p[2])));
      bytes = Math.max(1, Math.round(p[1].length / 2));
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(p[1], 16), hi = Math.min(parseInt(p[2], 16), lo + 65535);
      if (p[3][0] === '[') {
        const list = [...p[3].matchAll(/<([0-9a-fA-F]*)>/g)].map(x => utf16be(hexBytes(x[1])));
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
      } else {
        const base = hexBytes(p[3].slice(1, -1));
        for (let c = lo; c <= hi; c++) {
          const b = Buffer.from(base);
          let add = c - lo, idx = b.length - 1;
          while (add > 0 && idx >= 0) { const v = b[idx] + (add & 0xff); b[idx] = v & 0xff; add = (add >> 8) + (v >> 8); idx--; }
          map.set(c, utf16be(b));
        }
      }
      bytes = Math.max(1, Math.round(p[1].length / 2));
    }
  }
  return map.size ? { map, bytes } : null;
}

function decodeWith(font, b) {
  if (font && font.cmap) {
    const { map, bytes } = font.cmap;
    let out = '';
    for (let i = 0; i + bytes <= b.length; i += bytes) {
      const code = bytes === 1 ? b[i] : b.readUIntBE(i, bytes);
      out += map.has(code) ? map.get(code) : '';
    }
    return out;
  }
  if (font && font.twoByte) return '';               // CID font without a map: unreadable
  if (b[0] === 0xfe && b[1] === 0xff) return utf16be(b.subarray(2));
  return b.toString('latin1');                       // WinAnsi/standard fonts ≈ Latin-1
}

function pageFonts(objs, pageDict, cache) {
  let res = dictGet(pageDict, 'Resources');
  let d = pageDict, guard = 0;
  while (!res && guard++ < 20) {                     // inherited from a parent /Pages node
    const parent = dictGet(d, 'Parent');
    if (!parent || !parent.ref || !objs.get(parent.ref)) break;
    d = objs.get(parent.ref).dict; res = dictGet(d, 'Resources');
  }
  if (res && res.ref) res = { dict: (objs.get(res.ref) || {}).dict || '' };
  let fontsV = res && res.dict ? dictGet(res.dict, 'Font') : null;
  if (fontsV && fontsV.ref) fontsV = { dict: (objs.get(fontsV.ref) || {}).dict || '' };
  const fonts = {};
  if (!fontsV || !fontsV.dict) return fonts;
  for (const f of fontsV.dict.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const num = Number(f[2]);
    if (!cache.has(num)) {
      const fd = (objs.get(num) || {}).dict || '';
      const tu = dictGet(fd, 'ToUnicode');
      const cm = tu && tu.ref ? streamOf(objs, tu.ref) : null;
      cache.set(num, { cmap: cm ? parseCMap(cm.toString('latin1')) : null, twoByte: /\/Subtype\s*\/Type0/.test(fd) });
    }
    fonts[f[1]] = cache.get(num);
  }
  return fonts;
}

function contentText(content, fonts) {
  let out = '', font = null, lastName = null, inArray = false, arr = [], pending = [], nums = [], lastY = null;
  const newline = () => { if (out && !/\s$/.test(out)) out += '\n'; };
  const re = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|\/[^\s/<>\[\]()]+|\[|\]|-?\d*\.?\d+|[A-Za-z'"*]+/g;
  let m;
  const show = (b) => decodeWith(font, b);
  while ((m = re.exec(content))) {
    const t = m[0];
    if (t[0] === '(') { const b = pdfLiteralBytes(t.slice(1, -1)); (inArray ? arr : pending).push(show(b)); }
    else if (t[0] === '<') { const b = hexBytes(t.slice(1, -1)); (inArray ? arr : pending).push(show(b)); }
    else if (t[0] === '/') lastName = t.slice(1);
    else if (t === '[') { inArray = true; arr = []; }
    else if (t === ']') { inArray = false; pending.push(arr.join('')); }
    else if (/^-?\d*\.?\d+$/.test(t)) {
      // A big negative kerning gap inside TJ usually means a space.
      if (inArray && Number(t) < -180 && arr.length && !/\s$/.test(arr[arr.length - 1])) arr.push(' ');
      if (!inArray) { nums.push(Number(t)); if (nums.length > 6) nums.shift(); }
      continue;
    }
    else if (t === 'Tf') { font = fonts[lastName] || null; pending = []; }
    else if (t === 'Tj' || t === 'TJ') { out += pending.join(''); pending = []; }
    else if (t === "'" || t === '"') { out += '\n' + pending.join(''); pending = []; }
    else if (t === 'Td' || t === 'TD') {
      // Only a vertical move starts a new line; horizontal moves place words or letters on the same line.
      const ty = nums.length >= 2 ? nums[nums.length - 1] : 1;
      if (Math.abs(ty) > 0.01) newline();
      pending = [];
    }
    else if (t === 'Tm') { const y = nums.length >= 6 ? nums[5] : null; if (y === null || lastY === null || Math.abs(y - lastY) > 0.5) newline(); lastY = y; pending = []; }
    else if (t === 'T*') { newline(); pending = []; }
    else if (t === 'ET') { if (out && !out.endsWith('\n')) out += '\n'; pending = []; }
    else if (t === 'BI') { const ei = content.indexOf('EI', re.lastIndex); if (ei > -1) re.lastIndex = ei + 2; } // inline image data
    else if (t === 'BT') pending = [];
    if (!/^[\[\]]$/.test(t) && t[0] !== '(' && t[0] !== '<' && t[0] !== '/') nums = [];
  }
  return out;
}

function pdfText(buf) {
  const objs = pdfObjects(buf);
  // Pages in reading order: walk the page tree from the catalog; fall back to file order.
  let pages = [];
  const catalog = [...objs.values()].find(o => /\/Type\s*\/Catalog/.test(o.dict));
  const walk = (num, depth) => {
    const o = objs.get(num);
    if (!o || depth > 30 || pages.length > 2000) return;
    if (/\/Type\s*\/Pages/.test(o.dict)) { const kids = dictGet(o.dict, 'Kids'); if (kids && kids.array) refsIn(kids.array).forEach(k => walk(k, depth + 1)); }
    else if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(o);
  };
  const root = catalog && dictGet(catalog.dict, 'Pages');
  if (root && root.ref) walk(root.ref, 0);
  if (!pages.length) pages = [...objs.values()].filter(o => /\/Type\s*\/Page\b/.test(o.dict));
  const cache = new Map();
  let text = '';
  for (const p of pages) {
    const fonts = pageFonts(objs, p.dict, cache);
    const c = dictGet(p.dict, 'Contents');
    const nums = !c ? [] : c.ref !== undefined ? [c.ref] : c.array ? refsIn(c.array) : [];
    // /Contents can point at an array object holding the stream references.
    const expanded = nums.flatMap(n => { const o = objs.get(n); return o && !o.stream && /^\s*\[/.test(o.dict) ? refsIn(o.dict) : [n]; });
    const content = expanded.map(n => { const b = streamOf(objs, n); return b ? b.toString('latin1') : ''; }).join('\n');
    text += contentText(content, fonts) + '\n\n';
    if (text.length > MAX_TEXT * 2) break;
  }
  return { text, pages: pages.length };
}

function tidy(t) {
  return String(t || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function readable(t) {
  if (!t) return false;
  const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  return letters >= 20 && letters / t.length > 0.4;
}

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
