// Unit tests for the page reader and research prompt (Phase 5): HTML to text, pickRelevant, readPage/readMany,
// search queries and the citation prompt. fetch is mocked: no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../helpers/fixture');
const search = require('../../src/modules/search/search');
const { htmlToText, pickRelevant } = require('../../src/modules/search/text');
const reader = require('../../src/modules/search/reader');
const { buildQueries, contextBlock, todayLagos } = require('../../src/modules/search/prompt');
const prompts = require('../../src/modules/ai/prompts');
const ARTICLE = fixture('article.html');
/* ---------- helpers ---------- */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const res = (body, { status = 200, type = 'text/html; charset=utf-8', headers = {} } = {}) => new Response(
  typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type, ...headers } });
// fetch mock by URL pattern; records calls.
function routeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    for (const [re, reply] of routes) if (re.test(String(url))) return typeof reply === 'function' ? reply(String(url),
      init) : reply();
    return res('not found', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}
test.beforeEach(() => { search._resting.clear(); reader.pageCache.clear(); });
/* ---------- reader ---------- */
test('HTML to text: title and article paragraphs kept; scripts, nav, cookie banner, aside and footer dropped', () => {
  const { title, text, lang } = htmlToText(ARTICLE);
  assert.equal(title, 'MPC keeps rate at 27.5% | BusinessDay');
  assert.equal(lang, 'en');
  assert.match(text, /retained the Monetary Policy Rate at 27\.50 per cent/);
  assert.match(text, /expected & priced in/);
  assert.match(text, /^MPC keeps the monetary policy rate at 27\.5%/);
  for (const junk of ['do not read me', 'Home', 'cookies', 'Read also', 'All rights reserved']) assert.ok(
    !text.includes(junk), junk);
});
test('pickRelevant keeps the opening and the paragraphs about the question, within the limit', () => {
  const text = ['Intro paragraph about the Central Bank of Nigeria and its role in the economy of the country.',
    ...Array.from({ length: 40 }, (_,
    i) => `Unrelated paragraph number ${i} about football, music and the weather in Lagos this year.`),
    'The monetary policy rate was retained at 27.5 per cent by the MPC in November.'].join('\n\n');
  const out = pickRelevant(text, 'monetary policy rate', 400);
  assert.ok(out.length <= 400);
  assert.match(out, /^Intro paragraph/);
  assert.match(out, /27\.5 per cent/);
});
test('page reader: HTML read and trimmed, PDFs and binaries skipped, Wikipedia via its text API, 10-minute cache',
  async () => {
  const f = routeFetch([
    [/news\.example/, () => res(ARTICLE)],
    [/report\.example/, () => res('%PDF-1.7 …', { type: 'application/pdf' })],
    [/wikipedia\.org\/w\/api\.php/, () => res({ query: { pages: [{ title: 'Central Bank of Nigeria',
      extract: ('The Central Bank of Nigeria (CBN) is the central bank of Nigeria.\nIt sets the monetary policy '
      + 'rate through its Monetary Policy Committee.') }] } }, { type: 'application/json' })],
  ]);
  const p = await reader.readPage('https://news.example/mpc', { fetch: f, lookup: publicLookup,
    query: 'monetary policy rate', maxChars: 2500 });
  assert.equal(p.title, 'MPC keeps rate at 27.5% | BusinessDay');
  assert.ok(p.text.length <= 2500);
  await assert.rejects(reader.readPage('https://report.example/mpc', { fetch: f, lookup: publicLookup }),
    (e) => e.code === 'skipped');
  await assert.rejects(reader.readPage('https://x.example/file.pdf', { fetch: f, lookup: publicLookup }),
    (e) => e.code === 'skipped');
  const w = await reader.readPage('https://en.wikipedia.org/wiki/Central_Bank_of_Nigeria', { fetch: f });
  assert.match(w.text, /Monetary Policy Committee/);
  const before = f.calls.length;
  const again = await reader.readPage('https://news.example/mpc', { fetch: f, lookup: publicLookup,
    query: 'monetary policy rate', maxChars: 2500 });
  assert.ok(again.cached);
  assert.equal(f.calls.length, before);
  const lru = new reader.Lru(2, 1000);
  lru.set('a', 1, 0); lru.set('b', 2, 0); lru.get('a', 0); lru.set('c', 3, 0);
  assert.equal(lru.get('b', 0), undefined);
  assert.equal(lru.get('a', 0), 1);
  assert.equal(lru.get('a', 2000), undefined);
});
test('readMany: pages read in parallel; a slow page is left out when the overall budget runs out', async () => {
  const f = routeFetch([
    [/fast\.example/, () => res(ARTICLE)],
    [/slow\.example/, (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort',
      () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))],
  ]);
  const t = Date.now();
  const pages = await reader.readMany([{ url: 'https://fast.example/a' }, { url: 'https://slow.example/b' }],
    { count: 2, fetch: f, lookup: publicLookup, budgetMs: 150, timeoutMs: 5000, query: 'rate' });
  assert.ok(Date.now() - t < 1500);
  assert.deepEqual([...pages.keys()], ['https://fast.example/a']);
});
/* ---------- queries and the citation prompt ---------- */
test('search queries: filler stripped, the year added for "current" questions, keywords as a second query', () => {
  const q = buildQueries('Please can you tell me the current CBN monetary policy rate?', { now: new Date(
    '2026-11-12T12:00:00Z') });
  assert.deepEqual(q, ['the current CBN monetary policy rate 2026', 'cbn monetary policy rate']);
  assert.deepEqual(buildQueries('History of Lagos'), ['History of Lagos', 'history lagos']);
  // A short follow-up borrows the earlier question's topic.
  assert.match(buildQueries('and Ghana?', { previous: 'inflation rate in Nigeria' })[0],
    /inflation rate nigeria and Ghana/);
  assert.deepEqual(buildQueries(''), []);
});
test('citation prompt: numbered sources, strict rules, today in Africa/Lagos; a failure says so with no citations',
  () => {
  const now = new Date('2026-11-12T23:30:00Z');   // already 13 November in Lagos
  assert.equal(todayLagos(now), 'Friday, 13 November 2026');
  const block = contextBlock({ now, sources: [
    { n: 1, title: 'MPC decisions', url: 'https://cbn.gov.ng/mpc', site: 'cbn.gov.ng',
      text: 'The MPR was retained at 27.5%.' },
    { n: 2, title: 'Naira', url: 'https://en.wikipedia.org/wiki/Nigerian_naira', site: 'en.wikipedia.org',
      snippet: 'Currency of Nigeria' },
  ] });
  assert.match(block,
    /\[1\] MPC decisions\nURL: https:\/\/cbn\.gov\.ng\/mpc\nPage text:\nThe MPR was retained at 27\.5%\./);
  assert.match(block, /\[2\] Naira\nURL: .*\nSearch snippet:\nCurrency of Nigeria/);
  assert.match(block, /like \[1\] or \[2\]\[3\]/);
  assert.match(block, /never invent a source/);
  assert.match(block, /do not cover part of the question, say that clearly/);
  assert.match(block, /Friday, 13 November 2026, Africa\/Lagos/);
  assert.match(block, /untrusted web content/);
  const failed = contextBlock({ now, failed: true });
  assert.match(failed, /unavailable/);
  assert.match(failed, /do not invent links, sources or \[n\] citations/);
  // The Research system prompt switches between "cite the sources below" and "you cannot browse".
  assert.match(prompts.systemPrompt({ mode: 'research', web: true, context: block }),
    /Answer from them and cite them[\s\S]*<<<SOURCES/);
  assert.match(prompts.systemPrompt({ mode: 'research' }), /cannot browse the web/);
  // 0.10.4: every mode knows the app's in-chat browser; only Research without search says it cannot browse the web.
  assert.doesNotMatch(prompts.systemPrompt({ mode: 'general' }), /cannot browse|SOURCES/);
  assert.match(prompts.systemPrompt({ mode: 'developer' }), /Never say you cannot open, show, reopen or use a browser/);
});
