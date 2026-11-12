// Minimal multipart/form-data reader for one uploaded file (no dependency). Buffers up to `max` bytes,
// then stops reading and answers 413. Fine for 20 MB uploads on a 1 GB host; one upload at a time per request.
function readMultipartFile(req, { max = 21 * 1048576, field = 'file' } = {}) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    const bm = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!/^multipart\/form-data/i.test(type) || !bm) {
      return reject(Object.assign(new Error('Send the file as multipart/form-data.'), { status: 400,
        code: 'bad_upload' }));
    }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > max + 64 * 1024) {
      req.resume();
      return reject(Object.assign(new Error('That file is too large.'), { status: 413, code: 'too_large' }));
    }
    const boundary = Buffer.from(`--${bm[1] || bm[2]}`);
    const chunks = []; let size = 0, failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > max + 64 * 1024) {
        failed = true;
        reject(Object.assign(new Error('That file is too large.'), { status: 413, code: 'too_large' }));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('error', (e) => { if (!failed) { failed = true; reject(e); } });
    req.on('end', () => {
      if (failed) return;
      const body = Buffer.concat(chunks);
      const fields = {};
      let file = null;
      let pos = body.indexOf(boundary);
      while (pos > -1) {
        const start = pos + boundary.length;
        if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // closing "--"
        const headEnd = body.indexOf('\r\n\r\n', start);
        if (headEnd < 0) break;
        const head = body.toString('utf8', start, headEnd);
        const next = body.indexOf(boundary, headEnd + 4);
        if (next < 0) break;
        const content = body.subarray(headEnd + 4, next - 2); // minus the CRLF before the boundary
        const name = (head.match(/name="([^"]*)"/i) || [])[1];
        const filename = (head.match(/filename\*?="([^"]*)"/i) || [])[1];
        const ctype = (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1];
        if (filename !== undefined && name === field && !file) {
          file = { name: decodeName(filename), type: (ctype || '').trim(), data: Buffer.from(content) };
        } else if (name && filename === undefined) {
          fields[name] = content.toString('utf8').slice(0, 1000);
        }
        pos = next;
      }
      if (!file) return reject(Object.assign(new Error('No file was received.'), { status: 400, code: 'bad_upload' }));
      resolve({ file, fields });
    });
  });
}

function decodeName(n) {
  const base = String(n).split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>]/g, '').trim();
  return (base || 'file').slice(0, 180);
}

module.exports = { readMultipartFile };
