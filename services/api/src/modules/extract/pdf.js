// PDF text extraction (text-based PDFs; scanned PDFs have no text layer).
const zlib = require('zlib');
const { MB, MAX_TEXT, fail, safeChar } = require('./common');

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
    else if (/[0-7]/.test(n)) { let oct = n; while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i];
      out.push(parseInt(oct, 8) & 0xff); }
    else if (n === '\r') { if (s[i + 1] === '\n') i++; } else if (n === '\n') { /* line continuation */ } else out.push(
      n.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}
function hexBytes(h) { h = h.replace(/[^0-9a-fA-F]/g, ''); if (h.length % 2) h += '0'; return Buffer.from(h, 'hex'); }
const utf16be = (b) => { const c = Buffer.from(b); if (c.length % 2) return c.toString('latin1');
  return c.swap16().toString('utf16le'); };

// Reads the value of /Key in a dictionary's text: a reference, name, number, array or nested dictionary.
function dictGet(text, key) {
  const re = new RegExp('/' + key + '(?![A-Za-z0-9])\\s*', 'g');
  let m, depth = 0;
  // Only accept a key at the top level of this dictionary.
  while ((m = re.exec(text))) {
    depth = 0;
    for (let i = 0; i < m.index; i++) {
      if (text[i] === '<' && text[i + 1] === '<') { depth++; i++; } else if (text[i] === '>' && text[i + 1] === '>') {
        depth--; i++; }
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
      if (rest[j] === '<' && rest[j + 1] === '<') { d++; j++; } else if (rest[j] === '>' && rest[j + 1] === '>') { d--;
        j++; if (!d) break; }
    }
    return { dict: rest.slice(0, j + 1) };
  }
  if (rest[0] === '[') { let d = 0, j = 0; for (; j < rest.length; j++) { if (rest[j] === '[') d++;
    else if (rest[j] === ']' && !--d) break; } return { array: rest.slice(1, j) }; }
  const name = rest.match(/^\/([^\s/<>\[\]()]+)/);
  if (name) return { name: name[1] };
  const num = rest.match(/^-?\d+(\.\d+)?/);
  return num ? { num: Number(num[0]) } : null;
}
const refsIn = (arr) => [...String(arr).matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1]));

function inflate(data) {
  try { return zlib.inflateSync(data, { maxOutputLength: 16 * MB }); } catch {
    try { return zlib.inflateSync(data.subarray(0, data.length - 1), { maxOutputLength: 16 * MB });
      } catch { return null; }
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
          while (add > 0 && idx >= 0) { const v = b[idx] + (add & 0xff); b[idx] = v & 0xff; add = (add >> 8)
            + (v >> 8); idx--; }
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
    else if (t === 'Tm') { const y = nums.length >= 6 ? nums[5] : null; if (y === null || lastY === null || Math.abs(y
      - lastY) > 0.5) newline(); lastY = y; pending = []; }
    else if (t === 'T*') { newline(); pending = []; }
    else if (t === 'ET') { if (out && !out.endsWith('\n')) out += '\n'; pending = []; }
    // inline image data
    else if (t === 'BI') { const ei = content.indexOf('EI', re.lastIndex); if (ei > -1) re.lastIndex = ei + 2; }
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
    if (/\/Type\s*\/Pages/.test(o.dict)) { const kids = dictGet(o.dict, 'Kids'); if (kids && kids.array) refsIn(
      kids.array).forEach(k => walk(k, depth + 1)); }
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
    const expanded = nums.flatMap(n => { const o = objs.get(n); return o && !o.stream && /^\s*\[/.test(o.dict) ? refsIn(
      o.dict) : [n]; });
    const content = expanded.map(n => { const b = streamOf(objs, n); return b ? b.toString('latin1') : '';
      }).join('\n');
    text += contentText(content, fonts) + '\n\n';
    if (text.length > MAX_TEXT * 2) break;
  }
  return { text, pages: pages.length };
}

module.exports = { pdfText };
