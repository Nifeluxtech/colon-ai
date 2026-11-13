// Safe ZIP reader (Node zlib only) shared by Office/ODF containers (docx.js) and Developer-mode project archives.
// Safeguards: entry count cap, path traversal / absolute paths / NUL refused, declared and real sizes capped
// (zip-bomb guard: per entry, in total, and by compression ratio), encrypted and ZIP64 entries skipped.
const zlib = require('zlib');
const { MB, fail } = require('./common');

const LIMITS = { entries: 20000, entry: 64 * MB, total: 128 * MB, ratio: 200 };

// A ZIP entry name that would land outside the folder it is extracted to (or is not a plain relative path).
function unsafeName(name) {
  const n = String(name);
  if (!n || n.includes('\0')) return true;
  const p = n.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return true;
  return p.split('/').some((seg) => seg === '..');
}

/**
 * entries(buf, { strict }) -> [{ name, method, csize, size, offset, dir, encrypted, zip64 }]
 * strict: refuse the whole archive when any entry name is unsafe (project archives). Without it unsafe names
 * are dropped (Office containers never need them).
 */
function entries(buf, { strict = false, maxEntries = LIMITS.entries } = {}) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('This file looks damaged (no ZIP directory).', 'processing');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > maxEntries) fail(`This archive has too many files (more than ${maxEntries}).`, 'too_large');
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (unsafeName(name)) {
      if (strict) fail('This archive has unsafe file paths (such as “../”) and was not opened.', 'unsafe');
      continue;
    }
    out.push({ name: name.replace(/\\/g, '/'), method, csize, size, offset, dir: /\/$/.test(name),
      encrypted: Boolean(flags & 1), zip64: csize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff });
  }
  return out;
}

// The declared uncompressed size of the whole archive, checked before anything is inflated.
function assertSane(list, { total = LIMITS.total, ratio = LIMITS.ratio } = {}) {
  const sum = list.reduce((n, e) => n + e.size, 0);
  if (sum > total) fail('This archive is too large to read once unpacked.', 'too_large');
  for (const e of list) {
    if (e.size > MB && e.csize > 0 && e.size / e.csize > ratio) {
      fail('This archive looks like a zip bomb (it unpacks to far more than its size) and was not opened.', 'unsafe');
    }
  }
  return sum;
}

// Inflates one entry; returns a Buffer or null (encrypted, ZIP64, unknown method, damaged or over `max`).
function read(buf, e, max = LIMITS.entry) {
  if (e.dir || e.encrypted || e.zip64 || e.size > max) return null;
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) return null;
  const lnameLen = buf.readUInt16LE(e.offset + 26), lextra = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + lnameLen + lextra;
  const data = buf.subarray(start, start + e.csize);
  try {
    if (e.method === 0) return data.length > max ? null : data;
    const cap = Math.max(1, Math.min(max, e.size || max));
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: cap });
  } catch { return null; }
  return null;
}

module.exports = { entries, read, assertSane, unsafeName, LIMITS };
