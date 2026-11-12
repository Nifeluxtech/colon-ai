// Unit tests for web search in Research mode (Phase 5, src/search): DuckDuckGo and Wikipedia parsers, blocked-page
// detection and fallback, the SSRF guard, HTML to text, the page reader, citation prompt building, and the SSE
// order in a research reply (status → sources → answer), including a failed search that still answers.
// fetch and DNS are mocked: no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const search = require('../src/search');
const { parseDdgHtml, parseDdgLite, unwrapDdg, isDdgBlocked, parseWikiSearch, parseOpenSearch, wikiQuery, PROVIDERS } = require('../src/search/providers');
const { checkUrl, isPrivateIp, safeFetch } = require('../src/search/net');
const { htmlToText, pickRelevant } = require('../src/search/text');
const reader = require('../src/search/reader');
const { buildQueries, contextBlock, todayLagos } = require('../src/search/prompt');
const searchConfig = require('../src/search/config');
const { respond, UNAVAILABLE } = require('../src/chat/reply');
const { createParser } = require('../src/ai/sse');
const prompts = require('../src/ai/prompts');

/* ---------- fixtures ---------- */
const DDG_HTML = `<!DOCTYPE html><html><body><div id="links" class="results">
<div class="result results_links results_links_deep result--ad"><div class="links_main links_deep result__body">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=loans.example&amp;u3=x">Fast loans in Lagos</a></h2>
  <a class="result__snippet" href="https://duckduckgo.com/y.js?x">Sponsored</a></div></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.cbn.gov.ng%2Fmonetarypolicy%2Fdecisions.html&amp;rut=abc">CBN &amp; <b>Monetary Policy</b> Decisions</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">The <b>MPC</b> retained the <b>MPR</b> at 27.50 per cent&#x2026;</a></div></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FCentral_Bank_of_Nigeria&amp;rut=def">Central Bank of Nigeria - Wikipedia</a></h2>
  <a class="result__snippet" href="#">The Central Bank of Nigeria is the apex monetary authority.</a></div></div>
</div></body></html>`;

const DDG_LITE = `<html><body><table>
<tr><td>1.&nbsp;</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnairametrics.com%2Fmpr%2F&amp;rut=1" class='result-link'>MPR news | Nairametrics</a></td></tr>
<tr><td>&nbsp;</td><td class='result-snippet'>The <b>Monetary Policy</b> Rate (MPR) is the benchmark&hellip;</td></tr>
<tr><td>2.&nbsp;</td><td><a rel="nofollow" href="https://punchng.com/cbn-holds-rate/" class='result-link'>CBN holds rate - Punch</a></td></tr>
<tr><td>&nbsp;</td><td class='result-snippet'>Punch reports the MPC decision.</td></tr>
</table></body></html>`;

const DDG_BLOCKED = '<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div><form id="challenge-form"></form></body></html>';

const WIKI_SEARCH = { query: { search: [
  { title: 'Central Bank of Nigeria', snippet: 'The <span class="searchmatch">CBN</span> decides interest rates' },
  { title: 'Nigerian naira', snippet: 'Currency of Nigeria &amp; issued by the CBN' },
] } };

const ARTICLE = `<!doctype html><html lang="en"><head><title>MPC keeps rate at 27.5% | BusinessDay</title><script>var tracking = "do not read me";</script><style>.x{}</style></head>
<body><header><nav><ul><li><a href="/">Home</a></li><li><a href="/news">News</a></li><li>Markets</li></ul></nav></header>
<div class="cookie-banner"><p>We use cookies to improve your experience on this website, accept them please.</p></div>
<main><article><h1>MPC keeps the monetary policy rate at 27.5%</h1>
<p>The Monetary Policy Committee (MPC) of the Central Bank of Nigeria on Tuesday retained the Monetary Policy Rate at 27.50 per cent, the CBN Governor said in Abuja.</p>
<p>Inflation eased for the fifth month in a row, according to the National Bureau of Statistics, giving the committee room to hold.</p>
<aside><p>Read also: ten things to know about crypto and other unrelated sidebar content.</p></aside>
<p>Analysts at Lagos-based firms said the decision was expected &amp; priced in by the market.</p>
</article></main><footer><p>© 2026 BusinessDay Media. All rights reserved. Terms, privacy and contact pages.</p></footer></body></html>`;

/* ---------- helpers ---------- */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const res = (body, { status = 200, type = 'text/html; charset=utf-8', headers = {} } = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type, ...headers } });

// fetch mock by URL pattern; records calls.
function routeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    for (const [re, reply] of routes) if (re.test(String(url))) return typeof reply === 'function' ? reply(String(url), init) : reply();
    return res('not found', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const cfgWith = (ids, extra = {}) => {
  const c = searchConfig.merge({ ...extra });
  c.providers = c.order.map(id => ({ id, name: id, ready: ids.includes(id), key: id === 'brave' ? 'bravekey123' : '', baseUrl: '' }));
  return c;
};

test.beforeEach(() => { search._resting.clear(); reader.pageCache.clear(); });

/* ---------- parsers ---------- */
test('DuckDuckGo HTML: titles, snippets, uddg redirect unwrapped, ads skipped', () => {
  const r = parseDdgHtml(DDG_HTML);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { title: 'CBN & Monetary Policy Decisions', url: 'https://www.cbn.gov.ng/monetarypolicy/decisions.html', snippet: 'The MPC retained the MPR at 27.50 per cent…' });
  assert.equal(r[1].url, 'https://en.wikipedia.org/wiki/Central_Bank_of_Nigeria');
  assert.equal(unwrapDdg('https://duckduckgo.com/y.js?ad=1'), null);
  assert.equal(unwrapDdg('javascript:alert(1)'), null);
  assert.equal(unwrapDdg('https://example.com/a'), 'https://example.com/a');
});

test('DuckDuckGo lite: result-link rows with their snippets', () => {
  const r = parseDdgLite(DDG_LITE);
  assert.deepEqual(r.map(x => x.url), ['https://nairametrics.com/mpr/', 'https://punchng.com/cbn-holds-rate/']);
  assert.equal(r[0].snippet, 'The Monetary Policy Rate (MPR) is the benchmark…');
  assert.equal(r[1].title, 'CBN holds rate - Punch');
});

test('blocked-page detection: captcha/anomaly pages and 202/403/429 count as blocked', () => {
  assert.ok(isDdgBlocked(200, DDG_BLOCKED));
  assert.ok(isDdgBlocked(202, ''));
  assert.ok(isDdgBlocked(429, ''));
  assert.ok(!isDdgBlocked(200, DDG_HTML));
});

test('Wikipedia: search JSON and opensearch JSON parse; question words, years and acronyms tidied', () => {
  const r = parseWikiSearch(WIKI_SEARCH, 'en');
  assert.equal(r[0].url, 'https://en.wikipedia.org/wiki/Central_Bank_of_Nigeria');
  assert.equal(r[0].snippet, 'The CBN decides interest rates');
  assert.equal(r[1].snippet, 'Currency of Nigeria & issued by the CBN');
  assert.equal(parseWikiSearch(WIKI_SEARCH, 'yo')[0].url, 'https://yo.wikipedia.org/wiki/Central_Bank_of_Nigeria');
  assert.deepEqual(parseOpenSearch(['lagos', ['Lagos'], ['City in Nigeria'], ['https://en.wikipedia.org/wiki/Lagos']]), [{ title: 'Lagos', url: 'https://en.wikipedia.org/wiki/Lagos', snippet: 'City in Nigeria' }]);
  assert.equal(wikiQuery('What is the current CBN monetary policy rate 2026'), 'Central Bank of Nigeria monetary policy rate');
});

test('DuckDuckGo provider: a captcha page throws "blocked" without trying lite; HTML results come back unwrapped', async () => {
  const blocked = routeFetch([[/duckduckgo/, () => res(DDG_BLOCKED, { status: 202 })]]);
  await assert.rejects(PROVIDERS.duckduckgo.search('cbn rate', { fetch: blocked }), (e) => e.code === 'blocked');
  assert.equal(blocked.calls.length, 1);
  assert.equal(blocked.calls[0].method, 'POST');
  assert.match(blocked.calls[0].body, /q=cbn\+rate/);
  const ok = routeFetch([[/html\.duckduckgo/, () => res(DDG_HTML)]]);
  const r = await PROVIDERS.duckduckgo.search('cbn rate', { fetch: ok, limit: 1 });
  assert.equal(r.length, 1);
  assert.equal(r[0].url, 'https://www.cbn.gov.ng/monetarypolicy/decisions.html');
  // HTML endpoint broken (no parsable results) -> lite is tried.
  const lite = routeFetch([[/html\.duckduckgo/, () => res('<html><body>layout changed</body></html>')], [/lite\.duckduckgo/, () => res(DDG_LITE)]]);
  assert.equal((await PROVIDERS.duckduckgo.search('mpr', { fetch: lite })).length, 2);
});

test('Wikipedia provider: English plus the Yorùbá wiki for a Yorùbá reply (local query kept)', async () => {
  const f = routeFetch([[/yo\.wikipedia/, () => res({ query: { search: [{ title: 'Nàìjíríà', snippet: 'Orílẹ̀-èdè' }] } }, { type: 'application/json' })], [/en\.wikipedia/, () => res(WIKI_SEARCH, { type: 'application/json' })]]);
  const r = await PROVIDERS.wikipedia.search('president of Nigeria', { fetch: f, lang: 'yo', localQuery: 'Ààrẹ Nàìjíríà' });
  assert.equal(r[0].url, 'https://en.wikipedia.org/wiki/Central_Bank_of_Nigeria');
  assert.equal(r[2].url, 'https://yo.wikipedia.org/wiki/N%C3%A0%C3%ACj%C3%ADr%C3%AD%C3%A0');
  assert.ok(r.some(x => x.url.includes('en.wikipedia.org')));
  assert.ok(f.calls.some(c => c.url.includes('yo.wikipedia') && decodeURIComponent(c.url.replace(/\+/g, ' ')).includes('Ààrẹ Nàìjíríà')));
});

test('keyed providers are used only when configured: Brave sends its key header and parses web.results', async () => {
  const f = routeFetch([[/api\.search\.brave\.com/, () => res({ web: { results: [{ title: 'CBN', url: 'https://cbn.gov.ng/', description: 'Central <strong>bank</strong>' }] } }, { type: 'application/json' })]]);
  const r = await PROVIDERS.brave.search('cbn', { fetch: f, key: 'bravekey123' });
  assert.deepEqual(r, [{ title: 'CBN', url: 'https://cbn.gov.ng/', snippet: 'Central bank' }]);
  assert.equal(f.calls[0].headers['X-Subscription-Token'], 'bravekey123');
  const old = { ...process.env };
  delete process.env.BRAVE_SEARCH_API_KEY; delete process.env.TAVILY_API_KEY; delete process.env.SEARXNG_URL;
  const fakeDb = { async one() { return null; }, async query() { return []; } };
  require('../src/lib/settings').clear();
  const cfg = await searchConfig.load(fakeDb);
  assert.deepEqual(cfg.providers.filter(p => p.ready).map(p => p.id), ['duckduckgo', 'wikipedia']);
  assert.equal(cfg.enabled, true);
  process.env.BRAVE_SEARCH_API_KEY = 'env-brave-key';
  require('../src/lib/settings').clear();
  const cfg2 = await searchConfig.load(fakeDb);
  assert.deepEqual(cfg2.providers.filter(p => p.ready).map(p => p.id), ['brave', 'duckduckgo', 'wikipedia']);
  assert.equal(cfg2.providers[0].keySource, 'environment');
  process.env = old;
});

/* ---------- chain and fallback ---------- */
test('fallback chain: a blocked DuckDuckGo hands over to Wikipedia, and rests for 10 minutes', async () => {
  const f = routeFetch([[/duckduckgo/, () => res(DDG_BLOCKED, { status: 202 })], [/wikipedia\.org\/w\/api\.php/, () => res(WIKI_SEARCH, { type: 'application/json' })]]);
  const cfg = cfgWith(['duckduckgo', 'wikipedia']);
  const r = await search.runChain(['cbn rate'], { cfg, fetch: f });
  assert.equal(r.provider, 'wikipedia');
  assert.equal(r.results.length, 2);
  assert.deepEqual(r.tried.map(t => `${t.provider}:${t.code || 'ok'}`), ['duckduckgo:blocked', 'wikipedia:ok']);
  assert.ok(search._resting.get('duckduckgo') > Date.now() + 9 * 60e3);
  // Next search: the resting provider goes last, so Wikipedia answers without touching DuckDuckGo.
  f.calls.length = 0;
  const r2 = await search.runChain(['naira'], { cfg, fetch: f });
  assert.equal(r2.provider, 'wikipedia');
  assert.ok(!f.calls.some(c => /duckduckgo/.test(c.url)));
});

test('fallback chain: the second query only runs when the first did not fill the list; duplicates dropped', async () => {
  const seen = [];
  const providers = { duckduckgo: { search: async (q) => { seen.push(q); return q === 'a' ? [{ title: 'A', url: 'https://a.ng/x' }] : [{ title: 'A2', url: 'https://www.a.ng/x/' }, { title: 'B', url: 'https://b.ng/' }]; } } };
  const r = await search.runChain(['a', 'b'], { cfg: cfgWith(['duckduckgo']), providers });
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(r.results.map(x => x.url), ['https://a.ng/x', 'https://b.ng/']);
  const none = await search.runChain(['a'], { cfg: cfgWith(['duckduckgo']), providers: { duckduckgo: { search: async () => { throw Object.assign(new Error('x'), { code: 'network' }); } } } });
  assert.deepEqual(none.results, []);
});

/* ---------- SSRF guard ---------- */
test('SSRF guard: private, loopback, link-local, CGNAT and metadata addresses are refused', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'not-an-ip']) {
    assert.ok(isPrivateIp(ip), ip);
  }
  for (const ip of ['93.184.216.34', '102.89.4.10', '172.32.0.1', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) assert.ok(!isPrivateIp(ip), ip);
  const bad = ['file:///etc/passwd', 'ftp://x.ng/', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://user:pw@example.com/', 'http://example.com:8080/', 'gopher://x', 'http://printer.local/'];
  for (const u of bad) await assert.rejects(checkUrl(u, { lookup: publicLookup }), (e) => e.code === 'blocked_url', u);
  // A public-looking name that resolves to a private address (DNS rebinding style) is refused too.
  await assert.rejects(checkUrl('https://evil.example/', { lookup: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }] }), (e) => e.code === 'blocked_url');
  assert.equal((await checkUrl('https://www.cbn.gov.ng/x', { lookup: publicLookup })).hostname, 'www.cbn.gov.ng');
});

test('SSRF guard: redirects are re-checked (no hop to a private address) and capped at 3', async () => {
  const toPrivate = routeFetch([[/start\.example/, () => res('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })]]);
  await assert.rejects(safeFetch('https://start.example/', { fetch: toPrivate, lookup: publicLookup }), (e) => e.code === 'blocked_url');
  assert.equal(toPrivate.calls.length, 1);
  let n = 0;
  const loop = routeFetch([[/loop\.example/, () => res('', { status: 301, headers: { location: `https://loop.example/${++n}` } })]]);
  await assert.rejects(safeFetch('https://loop.example/', { fetch: loop, lookup: publicLookup }), (e) => e.code === 'too_many_redirects');
  assert.equal(loop.calls.length, 4);
  // Size cap: a huge page is cut, not loaded whole.
  const big = routeFetch([[/big\.example/, () => res('<p>' + 'x'.repeat(3 * 1024 * 1024) + '</p>')]]);
  const r = await safeFetch('https://big.example/', { fetch: big, lookup: publicLookup, maxBytes: 100 * 1024 });
  assert.ok(r.text.length <= 100 * 1024);
});

/* ---------- reader ---------- */
test('HTML to text: title and article paragraphs kept; scripts, nav, cookie banner, aside and footer dropped', () => {
  const { title, text, lang } = htmlToText(ARTICLE);
  assert.equal(title, 'MPC keeps rate at 27.5% | BusinessDay');
  assert.equal(lang, 'en');
  assert.match(text, /retained the Monetary Policy Rate at 27\.50 per cent/);
  assert.match(text, /expected & priced in/);
  assert.match(text, /^MPC keeps the monetary policy rate at 27\.5%/);
  for (const junk of ['do not read me', 'Home', 'cookies', 'Read also', 'All rights reserved']) assert.ok(!text.includes(junk), junk);
});

test('pickRelevant keeps the opening and the paragraphs about the question, within the limit', () => {
  const text = ['Intro paragraph about the Central Bank of Nigeria and its role in the economy of the country.', ...Array.from({ length: 40 }, (_, i) => `Unrelated paragraph number ${i} about football, music and the weather in Lagos this year.`), 'The monetary policy rate was retained at 27.5 per cent by the MPC in November.'].join('\n\n');
  const out = pickRelevant(text, 'monetary policy rate', 400);
  assert.ok(out.length <= 400);
  assert.match(out, /^Intro paragraph/);
  assert.match(out, /27\.5 per cent/);
});

test('page reader: HTML read and trimmed, PDFs and binaries skipped, Wikipedia via its text API, 10-minute cache', async () => {
  const f = routeFetch([
    [/news\.example/, () => res(ARTICLE)],
    [/report\.example/, () => res('%PDF-1.7 …', { type: 'application/pdf' })],
    [/wikipedia\.org\/w\/api\.php/, () => res({ query: { pages: [{ title: 'Central Bank of Nigeria', extract: 'The Central Bank of Nigeria (CBN) is the central bank of Nigeria.\nIt sets the monetary policy rate through its Monetary Policy Committee.' }] } }, { type: 'application/json' })],
  ]);
  const p = await reader.readPage('https://news.example/mpc', { fetch: f, lookup: publicLookup, query: 'monetary policy rate', maxChars: 2500 });
  assert.equal(p.title, 'MPC keeps rate at 27.5% | BusinessDay');
  assert.ok(p.text.length <= 2500);
  await assert.rejects(reader.readPage('https://report.example/mpc', { fetch: f, lookup: publicLookup }), (e) => e.code === 'skipped');
  await assert.rejects(reader.readPage('https://x.example/file.pdf', { fetch: f, lookup: publicLookup }), (e) => e.code === 'skipped');
  const w = await reader.readPage('https://en.wikipedia.org/wiki/Central_Bank_of_Nigeria', { fetch: f });
  assert.match(w.text, /Monetary Policy Committee/);
  const before = f.calls.length;
  const again = await reader.readPage('https://news.example/mpc', { fetch: f, lookup: publicLookup, query: 'monetary policy rate', maxChars: 2500 });
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
    [/slow\.example/, (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))],
  ]);
  const t = Date.now();
  const pages = await reader.readMany([{ url: 'https://fast.example/a' }, { url: 'https://slow.example/b' }], { count: 2, fetch: f, lookup: publicLookup, budgetMs: 150, timeoutMs: 5000, query: 'rate' });
  assert.ok(Date.now() - t < 1500);
  assert.deepEqual([...pages.keys()], ['https://fast.example/a']);
});

/* ---------- queries and the citation prompt ---------- */
test('search queries: filler stripped, the year added for "current" questions, keywords as a second query', () => {
  const q = buildQueries('Please can you tell me the current CBN monetary policy rate?', { now: new Date('2026-11-12T12:00:00Z') });
  assert.deepEqual(q, ['the current CBN monetary policy rate 2026', 'cbn monetary policy rate']);
  assert.deepEqual(buildQueries('History of Lagos'), ['History of Lagos', 'history lagos']);
  // A short follow-up borrows the earlier question's topic.
  assert.match(buildQueries('and Ghana?', { previous: 'inflation rate in Nigeria' })[0], /inflation rate nigeria and Ghana/);
  assert.deepEqual(buildQueries(''), []);
});

test('citation prompt: numbered sources, strict rules, today in Africa/Lagos; a failure says so with no citations', () => {
  const now = new Date('2026-11-12T23:30:00Z');   // already 13 November in Lagos
  assert.equal(todayLagos(now), 'Friday, 13 November 2026');
  const block = contextBlock({ now, sources: [
    { n: 1, title: 'MPC decisions', url: 'https://cbn.gov.ng/mpc', site: 'cbn.gov.ng', text: 'The MPR was retained at 27.5%.' },
    { n: 2, title: 'Naira', url: 'https://en.wikipedia.org/wiki/Nigerian_naira', site: 'en.wikipedia.org', snippet: 'Currency of Nigeria' },
  ] });
  assert.match(block, /\[1\] MPC decisions\nURL: https:\/\/cbn\.gov\.ng\/mpc\nPage text:\nThe MPR was retained at 27\.5%\./);
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
  assert.match(prompts.systemPrompt({ mode: 'research', web: true, context: block }), /Answer from them and cite them[\s\S]*<<<SOURCES/);
  assert.match(prompts.systemPrompt({ mode: 'research' }), /cannot browse the web/);
  assert.doesNotMatch(prompts.systemPrompt({ mode: 'general' }), /browse|SOURCES/);
});

/* ---------- the research reply over SSE ---------- */
function fakeRes() {
  const r = new EventEmitter();
  r.chunks = []; r.writableEnded = false; r.socket = null;
  r.writeHead = () => {};
  r.write = (c) => { r.chunks.push(String(c)); return true; };
  r.end = () => { r.writableEnded = true; };
  r.events = () => {
    const out = [];
    const p = createParser((e) => out.push({ event: e.event, data: JSON.parse(e.data) }));
    p.push(r.chunks.join('')); p.end();
    return out;
  };
  return r;
}
const routing = {
  providers: () => ({ mock: { name: 'Mock', baseUrl: 'https://mock.provider/v1', apiKey: 'k' } }),
  targets: () => ({ m: [{ provider: 'mock', model: 'mock-1' }] }),
  routes: { general: ['m'], study: ['m'], research: ['m'], developer: ['m'], african: ['m'] },
  africanLanguages: ['yo'], models: [],
};
function modelFetch(answer) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const enc = new TextEncoder();
    const parts = answer.split(/(?<= )/).map(t => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).concat('data: [DONE]\n\n');
    let i = 0;
    return new Response(new ReadableStream({ pull(c) { if (i < parts.length) c.enqueue(enc.encode(parts[i++])); else c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  fn.calls = calls;
  return fn;
}
function memStore() {
  const s = { saved: null };
  s.start = async () => ({ id: 'm1', role: 'assistant', content: '', status: 'streaming' });
  s.finish = async (x) => { s.saved = x; return { id: 'm1', role: 'assistant', content: x.content, status: x.status, sources: x.sources || [] }; };
  return s;
}
const fastTimeouts = { firstTokenTimeoutMs: 2000, idleTimeoutMs: 2000, maxReplyMs: 5000, hedge: 1 };

test('research reply: status → sources → writing → answer deltas → done; sources reach the model and the saved message', async () => {
  const res = fakeRes();
  const store = memStore();
  const fetch = modelFetch('The MPR is 27.5% [1]. ');
  const searchImpl = {
    async research(o) {
      o.onStatus({ stage: 'searching' });
      o.onStatus({ stage: 'reading', count: 1 });
      return { ok: true, provider: 'duckduckgo', ms: 900, read: 1, sources: [{ n: 1, title: 'MPC decisions', url: 'https://cbn.gov.ng/mpc', site: 'cbn.gov.ng', snippet: 's', text: 'The MPR was retained at 27.5%.' }] };
    },
  };
  await respond({ req: { user: { id: 1 } }, res, mode: 'research', language: 'en', history: [{ role: 'user', content: 'current MPR?' }], counters: [], store, routing, fetch, timeouts: fastTimeouts, webSearch: true, searchText: 'current MPR?', searchImpl });
  const ev = res.events();
  assert.deepEqual(ev.map(e => e.event + (e.data.stage ? ':' + e.data.stage : '')).filter((e, i, a) => e !== 'delta' || a[i - 1] !== 'delta'),
    ['start', 'status:searching', 'status:reading', 'sources', 'status:writing', 'delta', 'done']);
  assert.deepEqual(ev.find(e => e.event === 'sources').data.sources, [{ n: 1, title: 'MPC decisions', url: 'https://cbn.gov.ng/mpc', site: 'cbn.gov.ng', snippet: 's' }]);
  const sys = fetch.calls[0].messages[0].content;
  assert.match(sys, /<<<SOURCES[\s\S]*\[1\] MPC decisions[\s\S]*The MPR was retained at 27\.5%\./);
  assert.equal(store.saved.content, 'The MPR is 27.5% [1]. ');
  assert.deepEqual(store.saved.sources, [{ n: 1, title: 'MPC decisions', url: 'https://cbn.gov.ng/mpc', site: 'cbn.gov.ng', snippet: 's' }]);
  assert.deepEqual(store.saved.web, { ok: true, provider: 'duckduckgo', ms: 900, read: 1 });
  assert.ok(!JSON.stringify(store.saved.sources).includes('retained'), 'page text is not stored');
});

test('research reply: a failed search still answers, with a notice first and no sources', async () => {
  for (const searchImpl of [
    { async research() { return { ok: false, sources: [], ms: 40, reason: 'no_results' }; } },
    { async research() { throw new Error('every provider exploded'); } },
  ]) {
    const res = fakeRes();
    const store = memStore();
    const fetch = modelFetch('From what I know, the MPR was 27.5%. ');
    await respond({ req: { user: null }, res, mode: 'research', language: 'en', history: [{ role: 'user', content: 'MPR?' }], counters: [], store, routing, fetch, timeouts: fastTimeouts, webSearch: true, searchText: 'MPR?', searchImpl });
    const ev = res.events();
    assert.ok(!ev.some(e => e.event === 'error'));
    assert.ok(!ev.some(e => e.event === 'sources'));
    assert.ok(ev.some(e => e.event === 'status' && e.data.stage === 'unavailable'));
    assert.equal(ev.find(e => e.event === 'delta').data.text, UNAVAILABLE);
    assert.equal(store.saved.status, 'complete');
    assert.equal(store.saved.content, UNAVAILABLE + 'From what I know, the MPR was 27.5%. ');
    assert.deepEqual(store.saved.sources, []);
    assert.equal(store.saved.web.ok, false);
    assert.match(fetch.calls[0].messages[0].content, /Web search: unavailable/);
  }
});

test('research reply: modes other than Research never search; nothing to search for means no notice', async () => {
  let searched = 0;
  const searchImpl = { async research() { searched++; return { ok: false, reason: 'no_query', sources: [] }; } };
  const res = fakeRes();
  await respond({ req: { user: null }, res, mode: 'general', language: 'en', history: [{ role: 'user', content: 'hi' }], counters: [], store: memStore(), routing, fetch: modelFetch('Hello! '), timeouts: fastTimeouts, webSearch: false, searchImpl });
  assert.equal(searched, 0);
  const res2 = fakeRes();
  const store2 = memStore();
  await respond({ req: { user: null }, res: res2, mode: 'research', language: 'en', history: [{ role: 'user', content: '' }], counters: [], store: store2, routing, fetch: modelFetch('What should I research? '), timeouts: fastTimeouts, webSearch: true, searchText: '', searchImpl });
  assert.equal(searched, 1);
  assert.ok(!res2.events().some(e => e.event === 'status'));
  assert.equal(store2.saved.content, 'What should I research? ');
});

test('research() end to end with mocked fetch: blocked DuckDuckGo → Wikipedia, pages read, numbered sources', async () => {
  const f = routeFetch([
    [/duckduckgo/, () => res(DDG_BLOCKED, { status: 202 })],
    [/list=search/, () => res(WIKI_SEARCH, { type: 'application/json' })],
    [/prop=extracts/, (url) => res({ query: { pages: [{ title: decodeURIComponent(/titles=([^&]+)/.exec(url)[1]).replace(/\+/g, ' '), extract: 'The Central Bank of Nigeria sets the monetary policy rate. '.repeat(5) } ] } }, { type: 'application/json' })],
  ]);
  const statuses = [];
  const r = await search.research({ text: 'What is the current CBN monetary policy rate?', language: 'en', cfg: cfgWith(['duckduckgo', 'wikipedia']), fetch: f, onStatus: (s) => statuses.push(s.stage + (s.count ? s.count : '')) });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'wikipedia');
  assert.deepEqual(statuses, ['searching', 'reading2']);
  assert.deepEqual(r.sources.map(s => s.n), [1, 2]);
  assert.equal(r.read, 2);
  assert.equal(r.sources[0].site, 'en.wikipedia.org');
  assert.match(r.sources[0].text, /monetary policy rate/);
  assert.deepEqual(search.publicSources(r.sources)[0], { n: 1, title: 'Central Bank of Nigeria', url: 'https://en.wikipedia.org/wiki/Central_Bank_of_Nigeria', site: 'en.wikipedia.org', snippet: 'The CBN decides interest rates' });
  const off = await search.research({ text: 'x y z', cfg: { ...cfgWith(['wikipedia']), enabled: false } });
  assert.equal(off.skipped, true);
});

test('model-written queries (Naijá/Yorùbá/Hausa/Igbo): "Q:" lines first, the faithful "EN:" translation as backup; failure -> null', async () => {
  const fetch = modelFetch('EN: Who is the current President of Nigeria? \nQ: current President of Nigeria \nQ: Nigerian president inauguration date ');
  const q = await search.modelQueries('Ta ni Ààrẹ Nàìjíríà lọ́wọ́lọ́wọ́?', { routing, fetch });
  assert.deepEqual(q, ['current President of Nigeria', 'Who is the current President of Nigeria', 'Nigerian president inauguration date']);
  assert.match(fetch.calls[0].messages[0].content, /EN: <a faithful/);
  const broken = async () => { throw new TypeError('fetch failed'); };
  assert.equal(await search.modelQueries('Ta ni?', { routing, fetch: broken }), null);
  assert.equal(await search.modelQueries('Ta ni?', { routing: null }), null);
});
