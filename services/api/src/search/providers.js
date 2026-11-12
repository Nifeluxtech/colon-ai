// Web search providers, all behind one interface:
//   provider.search(query, { limit, lang, signal, fetch, key, baseUrl }) -> [{ title, url, snippet }]
// Errors carry .code: 'blocked' (captcha / anomaly page / 403 / 429), 'http_<status>', 'timeout', 'network', 'parse'.
//
// Keyless (default chain): DuckDuckGo HTML (lite as a second try), then Wikipedia (English, plus the Naijá,
// Yorùbá, Hausa or Igbo Wikipedia when the reply is in that language). Keyed, only when configured: Brave
// Search API, Tavily, and a SearXNG instance (base URL). Nothing here needs an account to work.
const { safeFetch } = require('./net');
const { stripTags, decodeEntities, keywords } = require('./text');

const err = (code, message) => Object.assign(new Error(message || code), { code });

/* ---------- DuckDuckGo (no key) ---------- */
// Result links go through //duckduckgo.com/l/?uddg=<encoded target>&rut=…; ads go through /y.js.
function unwrapDdg(href) {
  href = decodeEntities(String(href || '').trim());
  if (href.startsWith('//')) href = 'https:' + href;
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (/(^|\.)duckduckgo\.com$/.test(u.hostname)) {
      if (u.pathname === '/l/' || u.pathname === '/l') return u.searchParams.get('uddg') || null;
      return null;                                   // /y.js ads and internal links
    }
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch { return null; }
}

function isDdgBlocked(status, html) {
  if (status === 202 || status === 403 || status === 429 || status === 418) return true;
  return /anomaly-modal|bots use DuckDuckGo|challenge-form|g-recaptcha|hcaptcha|cf-chl-|Unfortunately, bots/i.test(String(html || '').slice(0, 60000));
}

// html.duckduckgo.com/html: <a class="result__a" href="…">Title</a> … <a class="result__snippet">Snippet</a>
function parseDdgHtml(html) {
  const out = [];
  const blocks = String(html || '').split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const b of blocks) {
    if (/result--ad\b/.test(b.slice(0, 200)) || /badge--ad/.test(b)) continue;
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b) || /<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!a) continue;
    const url = unwrapDdg(a[1]);
    if (!url) continue;
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(b);
    out.push({ title: stripTags(a[2]), url, snippet: sn ? stripTags(sn[1]) : '' });
  }
  return out;
}

// lite.duckduckgo.com/lite: a table; <a class="result-link" href="…">Title</a> then <td class="result-snippet">.
function parseDdgLite(html) {
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*result-link[^"']*["'][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=["'][^"']*result-link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links = [...String(html || '').matchAll(re)];
  for (let i = 0; i < links.length; i++) {
    const m = links[i];
    const url = unwrapDdg(m[1] || m[3]);
    if (!url) continue;
    const rest = html.slice(m.index + m[0].length, links[i + 1] ? links[i + 1].index : undefined);
    const sn = /class=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/i.exec(rest);
    out.push({ title: stripTags(m[2] || m[4]), url, snippet: sn ? stripTags(sn[1]) : '' });
  }
  return out;
}

const DDG_REGION = { en: 'ng-en', pcm: 'ng-en', yo: 'ng-en', ha: 'ng-en', ig: 'ng-en' };

const duckduckgo = {
  id: 'duckduckgo', name: 'DuckDuckGo', keyless: true,
  async search(query, o = {}) {
    const form = new URLSearchParams({ q: query, kl: DDG_REGION[o.lang] || 'ng-en' }).toString();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/', 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' };
    const tries = [['https://html.duckduckgo.com/html/', parseDdgHtml], ['https://lite.duckduckgo.com/lite/', parseDdgLite]];
    let lastErr = null;
    for (const [url, parse] of tries) {
      try {
        const r = await safeFetch(url, { method: 'POST', body: form, headers, timeoutMs: o.timeoutMs || 5000, maxBytes: 800 * 1024, signal: o.signal, fetch: o.fetch, guard: false, maxRedirects: 1 });
        if (isDdgBlocked(r.status, r.text)) { lastErr = err('blocked', 'DuckDuckGo asked for a captcha'); break; }   // lite is blocked the same way
        if (r.status !== 200) { lastErr = err(`http_${r.status}`); continue; }
        const list = parse(r.text);
        if (list.length) return list.slice(0, o.limit || 8);
        if (/No (more )?results|No results found/i.test(r.text)) return [];
        lastErr = err('parse', 'DuckDuckGo page had no results we could read');
      } catch (e) {
        if (e.name === 'AbortError' || e.code === 'aborted') throw e;
        lastErr = e;
      }
    }
    throw lastErr || err('parse');
  },
};

/* ---------- Wikipedia (no key) ---------- */
const WIKI_LANGS = { pcm: 'pcm', yo: 'yo', ha: 'ha', ig: 'ig' };
const WIKI_UA = { 'User-Agent': 'ColonAI/0.5 (https://chat.apparatus.name.ng; Nifelux) node-fetch', Accept: 'application/json' };

const wikiUrl = (lang, title) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':')}`;

// action=query&list=search JSON -> results
function parseWikiSearch(json, lang = 'en') {
  const list = (json && json.query && json.query.search) || [];
  return list.map(x => ({ title: x.title, url: wikiUrl(lang, x.title), snippet: stripTags(x.snippet || '') }));
}

// opensearch JSON [query, titles[], descriptions[], urls[]] -> results (kept for SearXNG-less fallbacks and tests)
function parseOpenSearch(json) {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  return json[1].map((t, i) => ({ title: t, url: (json[3] && json[3][i]) || '', snippet: (json[2] && json[2][i]) || '' })).filter(r => r.url);
}

async function wikiSearch(lang, query, o) {
  const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(Math.min(o.limit || 5, 10)), srprop: 'snippet', format: 'json', utf8: '1' });
  const r = await safeFetch(url, { headers: WIKI_UA, timeoutMs: o.timeoutMs || 5000, maxBytes: 300 * 1024, signal: o.signal, fetch: o.fetch, guard: false, maxRedirects: 1 });
  if (r.status === 429 || r.status === 403) throw err('blocked', `Wikipedia answered ${r.status}`);
  if (r.status !== 200) throw err(`http_${r.status}`);
  let j;
  try { j = JSON.parse(r.text); } catch { throw err('parse', 'Wikipedia answered with something other than JSON'); }
  return parseWikiSearch(j, lang);
}

// Wikipedia's search matches words, not questions: drop question words and years, spell out Nigerian acronyms.
const ACRONYMS = { cbn: 'Central Bank of Nigeria', nbs: 'National Bureau of Statistics Nigeria', inec: 'Independent National Electoral Commission', nnpc: 'NNPC Limited', efcc: 'Economic and Financial Crimes Commission', jamb: 'Joint Admissions and Matriculation Board', waec: 'West African Examinations Council', neco: 'National Examinations Council Nigeria', nysc: 'National Youth Service Corps', firs: 'Federal Inland Revenue Service', ncc: 'Nigerian Communications Commission', nin: 'National Identification Number Nigeria', mpr: 'monetary policy rate', mpc: 'Monetary Policy Committee', fg: 'Federal Government of Nigeria' };
function wikiQuery(q) {
  const ws = keywords(q).filter(w => !/^(19|20)\d{2}$/.test(w));
  const out = ws.map(w => ACRONYMS[w] || w).join(' ');
  return out.trim() || String(q);
}

const wikipedia = {
  id: 'wikipedia', name: 'Wikipedia', keyless: true,
  async search(query, o = {}) {
    const local = WIKI_LANGS[o.lang];
    const limit = o.limit || 5;
    const jobs = [wikiSearch('en', wikiQuery(query), o)];
    if (local) jobs.push(wikiSearch(local, o.localQuery || query, { ...o, limit: 3 }));
    const settled = await Promise.allSettled(jobs);
    if (settled.every(s => s.status === 'rejected')) throw settled[0].reason;
    const [en, loc] = settled.map(s => (s.status === 'fulfilled' ? s.value : []));
    // English Wikipedia is far bigger, so it leads; the reader's own-language wiki gets up to two places.
    if (!loc || !loc.length) return en.slice(0, limit);
    const mine = loc.slice(0, Math.min(2, limit - 1));
    const lead = en.slice(0, limit - mine.length);
    return [...lead.slice(0, 3), ...mine, ...lead.slice(3)].slice(0, limit);
  },
};

/* ---------- Brave Search API (key) ---------- */
const brave = {
  id: 'brave', name: 'Brave Search', needs: 'key',
  async search(query, o = {}) {
    const url = 'https://api.search.brave.com/res/v1/web/search?' + new URLSearchParams({ q: query, count: String(Math.min(o.limit || 5, 20)), country: 'NG', safesearch: 'moderate', text_decorations: 'false' });
    const r = await safeFetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': o.key }, timeoutMs: o.timeoutMs || 5000, signal: o.signal, fetch: o.fetch, guard: false, maxBytes: 600 * 1024 });
    if (r.status === 429) throw err('blocked', 'Brave rate limit');
    if (r.status === 401 || r.status === 403) throw err('auth', 'Brave key refused');
    if (r.status !== 200) throw err(`http_${r.status}`);
    let j; try { j = JSON.parse(r.text); } catch { throw err('parse'); }
    return ((j.web && j.web.results) || []).map(x => ({ title: stripTags(x.title), url: x.url, snippet: stripTags(x.description || '') }));
  },
};

/* ---------- Tavily (key) ---------- */
const tavily = {
  id: 'tavily', name: 'Tavily', needs: 'key',
  async search(query, o = {}) {
    const r = await safeFetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${o.key}` },
      body: JSON.stringify({ query, max_results: Math.min(o.limit || 5, 10), search_depth: 'basic', include_answer: false }),
      timeoutMs: o.timeoutMs || 6000, signal: o.signal, fetch: o.fetch, guard: false, maxBytes: 600 * 1024,
    });
    if (r.status === 429 || r.status === 432) throw err('blocked', 'Tavily limit');
    if (r.status === 401 || r.status === 403) throw err('auth', 'Tavily key refused');
    if (r.status !== 200) throw err(`http_${r.status}`);
    let j; try { j = JSON.parse(r.text); } catch { throw err('parse'); }
    return (j.results || []).map(x => ({ title: String(x.title || ''), url: x.url, snippet: String(x.content || '').slice(0, 500) }));
  },
};

/* ---------- SearXNG (your own or a friendly instance; base URL, JSON format must be on) ---------- */
const searxng = {
  id: 'searxng', name: 'SearXNG', needs: 'url',
  async search(query, o = {}) {
    const base = String(o.baseUrl || '').replace(/\/+$/, '');
    const url = `${base}/search?` + new URLSearchParams({ q: query, format: 'json', language: o.lang && o.lang !== 'en' && o.lang !== 'pcm' ? o.lang : 'en', safesearch: '1' });
    // A configured instance could be anywhere, so it goes through the SSRF guard like any page.
    const r = await safeFetch(url, { headers: { Accept: 'application/json', ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}) }, timeoutMs: o.timeoutMs || 6000, signal: o.signal, fetch: o.fetch, lookup: o.lookup, maxBytes: 800 * 1024 });
    if (r.status === 429 || r.status === 403) throw err('blocked', `SearXNG answered ${r.status}`);
    if (r.status !== 200) throw err(`http_${r.status}`);
    let j; try { j = JSON.parse(r.text); } catch { throw err('parse', 'SearXNG JSON output is off on this instance'); }
    return (j.results || []).map(x => ({ title: stripTags(x.title || ''), url: x.url, snippet: stripTags(x.content || '') }));
  },
};

const PROVIDERS = { brave, tavily, searxng, duckduckgo, wikipedia };

module.exports = { PROVIDERS, wikiQuery, parseDdgHtml, parseDdgLite, unwrapDdg, isDdgBlocked, parseWikiSearch, parseOpenSearch, wikiUrl };
