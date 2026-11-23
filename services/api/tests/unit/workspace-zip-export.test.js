// v0.31.0: "Download as ZIP" — the dependency-free zip writer, the owner-only export (folders, empty folders kept,
// nothing secret), the GET /workspaces/:id/export handler and the chat's "export my files as zip" card. In-memory
// store; no database and no network. A small reader below checks the archive the way unzip would.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const ws = require('../../src/modules/workspace');
const { zip, crc32 } = require('../../src/modules/workspace/zip');
const exporter = require('../../src/modules/workspace/exporter');
const { createChat } = require('../../src/modules/workspace/chat');
const connect = require('../../src/modules/workspace/connect');

const ME = { id: 1 }, OTHER = { id: 2 };

// Buffer -> [{ name, data, method, dir }] from the central directory, checking every CRC and both headers agree
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > -1, 'end of central directory');
  const count = buf.readUInt16LE(end + 10), out = [];
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const raw = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    assert.equal(buf.readUInt16LE(p + 8) & 0x0800, 0x0800, 'UTF-8 names');
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    assert.equal(buf.readUInt32LE(off), 0x04034b50);
    assert.equal(buf.readUInt32LE(off + 14), crc);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const packed = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(packed) : Buffer.from(packed);
    assert.equal(data.length, raw);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out.push({ name, data, method, dir: name.endsWith('/') });
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

test('zip: deflates text, stores what does not shrink, adds folder entries, round-trips', () => {
  const png = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 97) % 256));
  const buf = zip([{ path: 'site/index.html', content: Buffer.from('<h1>Hi</h1>'.repeat(50)) },
    { path: 'site/img/a.png', content: png }, { path: 'site/empty/.gitkeep', content: Buffer.alloc(0) }]);
  const e = unzip(buf);
  assert.deepEqual(e.map((x) => x.name), ['site/', 'site/empty/', 'site/img/', 'site/empty/.gitkeep',
    'site/img/a.png', 'site/index.html']);
  const by = Object.fromEntries(e.map((x) => [x.name, x]));
  assert.equal(by['site/index.html'].method, 8);
  assert.equal(by['site/index.html'].data.toString(), '<h1>Hi</h1>'.repeat(50));
  assert.equal(by['site/img/a.png'].method, 0);
  assert.deepEqual(by['site/img/a.png'].data, png);
  assert.equal(by['site/empty/.gitkeep'].data.length, 0);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.deepEqual(unzip(zip([])), []);
});

test('exportZip: every file in one folder named after the site, empty folders kept, owner only', async () => {
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'My Café Site!', template: 'blank' });
  await e.writeFile(ME, w.id, { path: 'pages/about.html', content: '<p>About</p>' });
  await e.writeFile(ME, w.id, { path: 'assets/fonts/.gitkeep', content: '' });
  await e.writeFile(ME, w.id, { path: 'img/dot.png', content: Buffer.from([137, 80, 78, 71]).toString('base64'),
    encoding: 'base64' });
  const z = await e.exportZip(ME, w.id);
  assert.match(z.name, /^my-cafe-site-v\d+\.zip$/);
  assert.equal(z.folder, 'my-cafe-site');
  const names = unzip(z.buffer).map((x) => x.name);
  for (const n of ['my-cafe-site/index.html', 'my-cafe-site/pages/about.html', 'my-cafe-site/assets/fonts/',
    'my-cafe-site/assets/fonts/.gitkeep', 'my-cafe-site/img/dot.png']) assert.ok(names.includes(n), n);
  const files = (await e.get(ME, w.id)).files;
  assert.equal(z.files, files.length - 1);   // .gitkeep isn't counted as a file
  assert.deepEqual(unzip(z.buffer).find((x) => x.name.endsWith('dot.png')).data, Buffer.from([137, 80, 78, 71]));
  await assert.rejects(e.exportZip(OTHER, w.id), (x) => x.status === 404);
  await assert.rejects(e.exportZip(null, w.id), (x) => x.status === 401);
});

test('exportZip leaves secrets out: Data tab keys are not files, stray key files are skipped', async () => {
  const store = ws.memoryStore();
  const e = ws.create({ store });
  const { workspace: w } = await e.add(ME, { title: 'Keys', template: 'blank' });
  // paths.js refuses these names; put them in storage directly to prove the export skips them anyway
  for (const p of ['.env', 'config/.env.local', 'certs/server.pem', 'id_rsa']) {
    await store.putFile(w.id, { path: p, mime: 'text/plain', content: Buffer.from('SECRET=1') });
  }
  const names = unzip((await e.exportZip(ME, w.id)).buffer).map((x) => x.name);
  assert.ok(names.includes('keys/index.html'));
  assert.ok(!names.some((n) => /\.env|\.pem|id_rsa/.test(n)), names.join(','));
  assert.ok(exporter.SECRET_FILE.test('a/.env.production') && !exporter.SECRET_FILE.test('envelope.html'));
});

test('GET /workspaces/:id/export answers a zip download, 404 for another user', async () => {
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Shop', template: 'blank' });
  const real = ws.instance;
  const index = require('../../src/modules/workspace');
  index.instance = () => e;
  try {
    let head = null, body = null;
    const res = { writeHead: (c, h) => { head = { c, h }; }, end: (b) => { body = b; } };
    await ws.handlers.getExport({ user: ME, params: { id: w.id } }, res);
    assert.equal(head.c, 200);
    assert.equal(head.h['Content-Type'], 'application/zip');
    assert.match(head.h['Content-Disposition'], /^attachment; filename="shop-v1\.zip"/);
    assert.equal(head.h['Content-Length'], body.length);
    assert.equal(head.h['X-Content-Type-Options'], 'nosniff');
    assert.ok(unzip(body).some((x) => x.name === 'shop/index.html'));
    await assert.rejects(ws.handlers.getExport({ user: OTHER, params: { id: w.id } }, res), (x) => x.status === 404);
  } finally { index.instance = real; }
});

test('wants / stripMark / line: what counts as asking for a zip', () => {
  for (const t of ['export my files as zip', 'Can you zip everything?', 'download my project', 'give me a .zip',
    'Also colon and user should be able to export the files as zip file']) assert.equal(exporter.wants(t), true, t);
  for (const t of ['add a zip code field', 'add a download button for my files', 'make the title blue',
    'export the data to a CSV page']) assert.equal(exporter.wants(t), false, t);
  assert.deepEqual(exporter.stripMark('Here you go.\n=== EXPORT: zip\n'), { text: 'Here you go.', marked: true });
  assert.equal(exporter.stripMark('No mark.').marked, false);
  assert.equal(exporter.line({ files: 3, bytes: 2048 }), '=== EXPORT: zip -- 3 files, 2 KB');
});

test('chat: "export my files as zip" adds the Download ZIP line after the reply\'s changes are saved', async () => {
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Cafe', template: 'blank' });
  let seen = null;
  const chat = createChat({ engine: e, deps: { generate: async (o) => { seen = o; return { text: 'Packed.\n'
    + '=== EXPORT: zip\n=== FILE: notes.txt\nhello\n=== END' }; } } });
  await chat.send(ME, w.id, { message: 'add notes and export my files as zip' }, { wait: true });
  assert.match(seen.context, /=== EXPORT: zip/);   // the prompt tells the model how
  const m = (await chat.history(ME, w.id)).messages[1];
  assert.match(m.content, /^Packed\.\n\n=== EXPORT: zip -- \d+ files, [\d.]+ (B|KB)$/);
  assert.ok(m.steps.some((x) => x.label === 'Packing your files as a ZIP' && x.state === 'done'));
  assert.ok(unzip((await e.exportZip(ME, w.id)).buffer).some((x) => x.name === 'cafe/notes.txt'));
  // a plain request with no mark from the model still gets the card; an unrelated one doesn't
  const quiet = createChat({ engine: e, deps: { generate: async () => ({ text: 'Sure.' }) } });
  await quiet.send(ME, w.id, { message: 'download my project' }, { wait: true });
  await quiet.send(ME, w.id, { message: 'what colour is the title?' }, { wait: true });
  const msgs = (await quiet.history(ME, w.id)).messages;
  assert.match(msgs[3].content, /=== EXPORT: zip -- /);
  assert.doesNotMatch(msgs[5].content, /EXPORT/);
});

test('Supabase personal access token: optional, sbp_ only, with the whole-account warning', () => {
  const p = connect.providersOut().find((x) => x.id === 'supabase');
  const t = p.server.find((f) => f.name === 'accessToken');
  assert.equal(t.optional, true);
  assert.equal(t.secret, true);
  assert.match(t.warn, /whole Supabase account/);
  assert.match(t.warn, /create a table, add a column/);
  const key = 'sb_secret_' + 'a'.repeat(30);
  assert.deepEqual(connect.cleanServer('supabase', { serviceKey: key }), { serviceKey: key });
  assert.throws(() => connect.cleanServer('supabase', { serviceKey: key, accessToken: 'ghp_nope1234567890' }),
    (x) => x.field === 'accessToken');
  const sbp = 'sbp_' + 'b'.repeat(40);
  assert.equal(connect.cleanServer('supabase', { serviceKey: key, accessToken: sbp }).accessToken, sbp);
});
