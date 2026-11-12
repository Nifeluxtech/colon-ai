// Integration tests for Research mode (chat reply + search + model router with mocked fetch): the SSE order
// status -> sources -> answer -> done, a failed search that still answers, other modes never searching,
// research() end to end, and model-written queries for African languages.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const search = require('../../src/modules/search/search');
const reader = require('../../src/modules/search/reader');
const searchConfig = require('../../src/modules/search/config');
const { respond, UNAVAILABLE } = require('../../src/modules/chat/reply');
const { createParser } = require('../../src/modules/ai/sse');
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
