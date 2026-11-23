// A tiny ZIP writer (v0.31.0, "Download as ZIP"): no dependency, only Node's zlib. Each entry is DEFLATEd when that
// makes it smaller (text) and STORED otherwise (images and fonts are already compressed). UTF-8 names (flag bit 11),
// no ZIP64: a workspace is at most 4 MB and 200 files (paths.js LIMITS), far under the 4 GB / 65 535-entry limits.
// Folders get their own entries ("css/"), so empty folders (kept as <folder>/.gitkeep) survive unzipping too.
//   zip([{ path, content: Buffer, date? }]) -> Buffer
const zlib = require('zlib');

let TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Date -> [MS-DOS time, MS-DOS date] (local fields; 1980 is the earliest a ZIP can say)
function dos(d) {
  const y = Math.max(1980, d.getFullYear());
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

// [{ path, content }] -> the same plus a "<folder>/" entry for every folder, folders first, in path order
function withFolders(entries) {
  const dirs = new Set();
  for (const e of entries) {
    const parts = e.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  const files = entries.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [...[...dirs].sort().map((p) => ({ path: p, content: Buffer.alloc(0), dir: true })), ...files];
}

function zip(entries, now = new Date()) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of withFolders(entries)) {
    const name = Buffer.from(e.path, 'utf8'), raw = Buffer.from(e.content || '');
    const crc = crc32(raw), packed = raw.length ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    const deflate = raw.length > 0 && packed.length < raw.length, data = deflate ? packed : raw;
    const [time, date] = dos(e.date instanceof Date ? e.date : now);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(deflate ? 8 : 0, 8); head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(0x0314, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(deflate ? 8 : 0, 10); cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(name.length, 28);
    // external attributes: Unix mode (drwxr-xr-x / -rw-r--r--) in the high word, MS-DOS directory bit in the low
    cen.writeUInt32LE(((e.dir ? 0o40755 : 0o100644) << 16 | (e.dir ? 0x10 : 0)) >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    locals.push(head, name, data);
    centrals.push(cen, name);
    offset += head.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), count = centrals.length / 2, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

module.exports = { zip, crc32, withFolders };
