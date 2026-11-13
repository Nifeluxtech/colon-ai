// Builds small ZIP archives in memory for tests (deflate, or stored with { store: true }).
//   makeZip({ 'src/app.js': 'code', 'logo.png': Buffer }, { declared: { 'big.txt': 999999999 } })
//   declared: lie about an entry's uncompressed size in the central directory (zip-bomb tests).
const zlib = require('zlib');

function makeZip(entries, { store = false, declared = {} } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = store ? raw : zlib.deflateRawSync(raw);
    const n = Buffer.from(name);
    const size = declared[name] != null ? declared[name] : raw.length;
    const method = store ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, comp); centrals.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

module.exports = { makeZip };
