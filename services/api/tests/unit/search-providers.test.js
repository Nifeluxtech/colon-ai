// Unit tests for web search providers (Phase 5, modules/search/providers): DuckDuckGo and Wikipedia parsers,
// blocked-page detection, keyed providers and the fallback chain. fetch is mocked: no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../../src/modules/search/search');
const { parseDdgHtml, parseDdgLite, unwrapDdg, isDdgBlocked, parseWikiSearch, parseOpenSearch, wikiQuery, PROVIDERS } = require('../../src/modules/search/providers');
const reader = require('../../src/modules/search/reader');
const searchConfig = require('../../src/modules/search/config');
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
  require('../../src/shared/settings').clear();
  const cfg = await searchConfig.load(fakeDb);
  assert.deepEqual(cfg.providers.filter(p => p.ready).map(p => p.id), ['duckduckgo', 'wikipedia']);
  assert.equal(cfg.enabled, true);
  process.env.BRAVE_SEARCH_API_KEY = 'env-brave-key';
  require('../../src/shared/settings').clear();
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
