// Unit tests for chat helpers: daily limits, reply language, prompts and context building.
// No database (a fake db object stands in for MySQL) and no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const limits = require('../../src/modules/ai/limits');
const prompts = require('../../src/modules/ai/prompts');
const { buildMessages } = require('../../src/modules/chat/context');
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
  await assert.rejects(limits.consume('u:7', 3, db), (e) => e.code === 'quota' && e.status === 429 && /limit of 3/.test(
    e.message));
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
  assert.equal(limits.subjectFor({ user: null, ip: '1.2.3.4', cookies: { colon_gid: 'bad id!' } }), limits.guestSubject(
    '1.2.3.4'));
  assert.deepEqual(limits.countersFor({ user: { id: 3, role: 'user' } }, cfg), [{ subject: 'u:3', limit: 100 }]);
  const db = fakeDb();
  await limits.consumeAll(limits.countersFor(reqA, cfg), db);
  await limits.consumeAll(limits.countersFor(reqA, cfg), db);
  await assert.rejects(limits.consumeAll(limits.countersFor(reqA, cfg), db), (e) => e.code === 'quota'
    && /guest replies/.test(e.message));
  await limits.consumeAll(limits.countersFor(reqB, cfg), db);           // same IP, other browser: own allowance
  await assert.rejects(limits.consumeAll(limits.countersFor(reqB, cfg), db), (e) => e.code === 'quota'
    && /your network/.test(e.message));
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
    { role: 'user', content: 'Summarise this', files: [{ name: 'r.pdf', kind: 'pdf', text: 'Lagos report', pages: 3 },
      img, { name: 'v.webm', kind: 'audio', duration: 4 }] },
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
  const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(
    5000) }));
  long.push({ role: 'user', content: 'latest' });
  const cut = buildMessages(long);
  assert.ok(cut.length < 24 && cut.length > 2);
  assert.equal(cut.at(-1).content, 'latest');
  assert.equal(cut[0].role, 'user');
});
