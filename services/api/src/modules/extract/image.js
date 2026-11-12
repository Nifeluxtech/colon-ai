// Images: width and height read from the file headers (PNG, JPEG, GIF, WebP).
/* ---------- Images: dimensions from headers ---------- */
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp') {
      const f = buf.toString('latin1', 12, 16);
      if (f === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (f === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (f === 'VP8L') { const v = buf.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1
        + ((v >> 14) & 0x3fff) }; }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return {};
}

module.exports = { imageSize };
