// Tiny static server for docroots built by scripts/deploy/build-docroot.sh (local checks only).
//   node scripts/dev/static-server.js <port> <dir>      Logs every 404.
const http = require('http'), fs = require('fs'), path = require('path');
const [port, dir] = process.argv.slice(2);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.md': 'text/plain' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p);
  fs.readFile(f, (e, b) => {
    if (e) { console.log('404 ' + req.url); res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(b);
  });
}).listen(+port, () => console.log('serving ' + dir + ' on ' + port));
