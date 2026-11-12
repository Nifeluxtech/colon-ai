// Unit tests for chat helpers: daily limits, reply language, prompts, context building and file
// extraction. No database (a fake db object stands in for MySQL) and no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');

const limits = require('../src/modules/ai/limits');
const prompts = require('../src/modules/ai/prompts');
const { buildMessages } = require('../src/modules/chat/context');
const extract = require('../src/modules/extract');

// In-memory stand-in for the two chat_usage queries limits.js runs.
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async query(sql, [subject]) {
      if (/^\s*INSERT INTO chat_usage/.test(sql)) rows.set(subject, (rows.get(subject) || 0) + 1);
      else if (/requests = requests - 1/.test(sql)) rows.set(subject, Math.max(0, (rows.get(subject) || 0) - 1));
      return [];
    },
    async one(sql, [subject]) { return rows.has(subject) ? { requests: rows.get(subject) } : null; },
  };
}

test('daily limit: counts replies, refuses past the limit without counting the refused one', async () => {
  const db = fakeDb();
  for (let i = 1; i <= 3; i++) assert.equal((await limits.consume('u:7', 3, db)).used, i);
  await assert.rejects(limits.consume('u:7', 3, db), (e) => e.code === 'quota' && e.status === 429 && /limit of 3/.test(e.message));
  assert.equal(db.rows.get('u:7'), 3);
  await limits.refund('u:7', db);
  assert.equal((await limits.usage('u:7', 3, db)).remaining, 1);
  await assert.rejects(limits.consume('u:8', 0, db), (e) => e.code === 'quota');
});

test('guests: lower limit, hashed IP subject (no raw IP stored), own message', async () => {
  const cfg = { dailyLimit: 100, guestDailyLimit: 15 };
  assert.equal(limits.limitFor({ user: null }, cfg), 15);
  assert.equal(limits.limitFor({ user: { id: 1, role: 'user' } }, cfg), 100);
  assert.equal(limits.limitFor({ user: { id: 1, role: 'admin' } }, cfg), 1000);
  const s = limits.guestSubject('102.89.1.5', 'secret');
  assert.match(s, /^g:[a-f0-9]{32}$/);
  assert.ok(!s.includes('102.89'));
  assert.equal(s, limits.guestSubject('102.89.1.5', 'secret'));
  assert.notEqual(s, limits.guestSubject('102.89.1.6', 'secret'));
  assert.equal(limits.subjectFor({ user: { id: 42 } }), 'u:42');
  const db = fakeDb();
  await limits.consume(s, 1, db);
  await assert.rejects(limits.consume(s, 1, db), (e) => /Log in or sign up/.test(e.message));
});

test('guests: counted per browser cookie when present, plus a shared per-IP cap', async () => {
  const cfg = { dailyLimit: 100, guestDailyLimit: 2, guestIpDailyLimit: 3 };
  const gidA = 'a'.repeat(32), gidB = 'b'.repeat(32);
  const reqA = { user: null, ip: '105.112.0.9', cookies: { colon_gid: gidA } };
  const reqB = { user: null, ip: '105.112.0.9', cookies: { colon_gid: gidB } };
  assert.notEqual(limits.subjectFor(reqA), limits.subjectFor(reqB));
  assert.equal(limits.subjectFor({ user: null, ip: '1.2.3.4', cookies: { colon_gid: 'bad id!' } }), limits.guestSubject('1.2.3.4'));
  assert.deepEqual(limits.countersFor({ user: { id: 3, role: 'user' } }, cfg), [{ subject: 'u:3', limit: 100 }]);
  const db = fakeDb();
  await limits.consumeAll(limits.countersFor(reqA, cfg), db);
  await limits.consumeAll(limits.countersFor(reqA, cfg), db);
  await assert.rejects(limits.consumeAll(limits.countersFor(reqA, cfg), db), (e) => e.code === 'quota' && /guest replies/.test(e.message));
  await limits.consumeAll(limits.countersFor(reqB, cfg), db);           // same IP, other browser: own allowance
  await assert.rejects(limits.consumeAll(limits.countersFor(reqB, cfg), db), (e) => e.code === 'quota' && /your network/.test(e.message));
  assert.equal(db.rows.get(limits.subjectFor(reqB)), 1);                 // refused reply not counted
  assert.equal(db.rows.get(limits.ipSubject('105.112.0.9')), 3);
});

test('reply language: detects Naijá, Yorùbá, Hausa and Igbo; a chosen language wins', () => {
  assert.equal(prompts.detectLanguage('Abeg, wetin dey happen for Lagos?'), 'pcm');
  assert.equal(prompts.detectLanguage('Ẹ káàrọ̀, ṣé dáadáa ni? Mo fẹ́ kọ́ ìwé'), 'yo');
  assert.equal(prompts.detectLanguage('Sannu, ina kwana? Don Allah ka taimake ni'), 'ha');
  assert.equal(prompts.detectLanguage('Kedu, biko nyere m aka. Daalu'), 'ig');
  assert.equal(prompts.detectLanguage('Explain how photosynthesis works'), null);
  assert.equal(prompts.detectLanguage(''), null);
  assert.equal(prompts.replyLanguage('yo', 'Explain photosynthesis'), 'yo');
  assert.equal(prompts.replyLanguage('en', 'How far, wetin dey sup? Abeg help me'), 'pcm');
  assert.equal(prompts.replyLanguage('en', 'Hello there'), 'en');
  assert.equal(prompts.replyLanguage(undefined, 'Hello'), 'en');
});

test('system prompt: African layer, mode behaviour and language rule', () => {
  const p = prompts.systemPrompt({ mode: 'study', language: 'pcm', name: 'Ada' });
  assert.match(p, /Colon Saga/);
  assert.match(p, /naira/);
  assert.match(p, /WAEC/);
  assert.match(p, /Mode: Study/);
  assert.match(p, /Nigerian Pidgin/);
  assert.match(p, /Ada/);
  assert.match(prompts.systemPrompt({ mode: 'developer' }), /Mode: Developer/);
  assert.match(prompts.systemPrompt({ mode: 'research', language: 'ha' }), /Reply in Hausa/);
  assert.match(prompts.systemPrompt({ mode: 'unknown' }), /Mode: General/);
});

test('context: history within budget, file text inlined, images only on the latest message', () => {
  const img = { name: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,AA==' };
  const msgs = buildMessages([
    { role: 'assistant', content: 'stray first assistant turn' },
    { role: 'user', content: 'first', files: [img, { name: 'n.txt', kind: 'text', text: 'old notes' }] },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'Summarise this', files: [{ name: 'r.pdf', kind: 'pdf', text: 'Lagos report', pages: 3 }, img, { name: 'v.webm', kind: 'audio', duration: 4 }] },
  ]);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs.length, 3);
  assert.equal(typeof msgs[0].content, 'string');
  assert.match(msgs[0].content, /image shown earlier/);
  assert.match(msgs[0].content, /old notes/);
  const last = msgs[2].content;
  assert.ok(Array.isArray(last));
  assert.match(last[0].text, /Attached PDF: “r\.pdf” \(3 pages\)[\s\S]*Lagos report/);
  assert.match(last[0].text, /Voice transcription isn’t available yet/);
  assert.equal(last[1].type, 'image_url');
  const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(5000) }));
  long.push({ role: 'user', content: 'latest' });
  const cut = buildMessages(long);
  assert.ok(cut.length < 24 && cut.length > 2);
  assert.equal(cut.at(-1).content, 'latest');
  assert.equal(cut[0].role, 'user');
});

/* ---------- File checks & extraction ---------- */
function makePdf(text, { compress = true } = {}) {
  const content = Buffer.from(`BT /F1 12 Tf 72 712 Td (${text}) Tj 0 -14 Td [(Second ) -250 (line)] TJ ET`);
  const data = compress ? zlib.deflateSync(content) : content;
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n'),
    Buffer.from(`4 0 obj << /Length ${data.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`), data, Buffer.from('\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF'),
  ]);
}
// Minimal ZIP writer (deflate) for DOCX/XLSX fixtures.
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content), comp = zlib.deflateRawSync(raw), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, comp); centrals.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('signature check: real type from the bytes, not the name', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 2, 0, 0, 0, 1, 0x80])]);
  const s = extract.validate(png, 'photo.png');
  assert.equal(s.kind, 'image');
  assert.deepEqual(extract.imageSize(png, 'image/png'), { width: 512, height: 384 });
  assert.throws(() => extract.validate(Buffer.from('MZ\x90\x00binary\x00\x01'), 'notes.pdf'), (e) => e.code === 'unsupported');
  assert.throws(() => extract.validate(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]), 'voice.webm'), (e) => e.code === 'unsupported'); // audio only from the recorder
  assert.equal(extract.validate(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]), 'voice.webm', { fromRecorder: true }).kind, 'audio');
  assert.throws(() => extract.validate(Buffer.alloc(0), 'x.txt'), (e) => e.code === 'empty');
  assert.throws(() => extract.validate(Buffer.alloc(2 * 1048576 + 1, 0x61), 'big.txt'), (e) => e.code === 'too_large');
  assert.throws(() => extract.validate(makeZip({ 'a.txt': 'x' }), 'archive.zip'), (e) => e.code === 'unsupported');
});

test('PDF text extraction (Flate and plain streams); scanned PDFs say so', () => {
  for (const compress of [true, false]) {
    const pdf = makePdf('Lagos is the largest city in Nigeria by population', { compress });
    const s = extract.validate(pdf, 'report.pdf');
    const r = extract.extract(pdf, s);
    assert.match(r.text, /Lagos is the largest city in Nigeria/);
    assert.match(r.text, /Second line/);
    assert.equal(r.meta.pages, 1);
  }
  const scanned = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Length 4 /Subtype /Image >>\nstream\nAAAA\nendstream endobj\n%%EOF');
  const r = extract.extract(scanned, { kind: 'pdf', mime: 'application/pdf' });
  assert.equal(r.text, '');
  assert.match(r.meta.note, /scanned/);
});

test('PDF with a subset font and a ToUnicode map (how Word, Docs and browsers write PDFs)', () => {
  // Glyph codes 0001-0005 map to "Ẹ káà", 0006 to "₦", 0007-0009 via a bfrange to "abc".
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
    '6 beginbfchar <0001> <1EB8> <0002> <0020> <0003> <006B> <0004> <00E1> <0005> <00E0> <0006> <20A6> endbfchar\n1 beginbfrange <0007> <0009> <0061> endbfrange endcmap end end';
  const content = zlib.deflateSync(Buffer.from('BT /F7 11 Tf 1 0 0 1 72 700 Tm [<00010002>-20<000300040005>] TJ 0 -14 Td <0006000700080009> Tj ET'));
  const cm = zlib.deflateSync(Buffer.from(cmap));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F7 5 0 R >> >> >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n'),
    Buffer.from(`4 0 obj << /Length ${content.length} /Filter /FlateDecode >>\nstream\n`), content, Buffer.from('\nendstream endobj\n'),
    Buffer.from('5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Inter /Encoding /Identity-H /ToUnicode 6 0 R >> endobj\n'),
    Buffer.from(`6 0 obj << /Length ${cm.length} /Filter /FlateDecode >>\nstream\n`), cm, Buffer.from('\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF'),
  ]);
  const r = extract.extract(pdf, extract.validate(pdf, 'yoruba.pdf'));
  assert.equal(r.text, '');  // under 20 letters doesn't count as a readable text layer…
  assert.match(r.meta.note, /No readable text/);
  assert.match(extract.pdfText(pdf).text, /Ẹ káà\n₦abc/);   // …but the glyphs decode correctly
});

test('DOCX, XLSX and RTF text extraction', () => {
  const docx = makeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Jollof rice recipe for twenty people</w:t></w:r></w:p><w:p><w:r><w:t>Tomatoes &amp; peppers, blended well</w:t></w:r></w:p></w:body></w:document>' });
  const d = extract.extract(docx, extract.validate(docx, 'recipe.docx'));
  assert.equal(d.text, 'Jollof rice recipe for twenty people\nTomatoes & peppers, blended well');
  const xlsx = makeZip({ 'xl/sharedStrings.xml': '<sst><si><t>State</t></si><si><t>Lagos</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>2024</v></c></row><row><c t="s"><v>1</v></c><c><v>15000000</v></c></row></sheetData></worksheet>' });
  const x = extract.extract(xlsx, extract.validate(xlsx, 'data.xlsx'));
  assert.match(x.text, /State\t2024\nLagos\t15000000/);
  const rtf = Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Welcome to Abuja, the capital city of Nigeria\\par Second paragraph here}');
  assert.match(extract.extract(rtf, extract.validate(rtf, 'note.rtf')).text, /Welcome to Abuja, the capital city of Nigeria\nSecond paragraph/);
});
