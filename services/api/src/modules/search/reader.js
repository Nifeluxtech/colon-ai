// Page reader: fetches result pages and turns them into short readable text for the model.
// Each page: SSRF-guarded fetch (public http/https only, at most 3 redirects), ~6 s timeout, 1.5 MB cap,
// HTML only (PDFs, images and other binaries are skipped), main text trimmed to ~2,500 characters around the
// question. Wikipedia articles are read through Wikipedia's plain-text API instead of scraping the HTML.
// Results are cached for 10 minutes in a small per-worker LRU, so a regenerate doesn't fetch everything again.
const { safeFetch } = require('./net');
const { htmlToText, pickRelevant } = require('./text');

class Lru {
  constructor(max = 100, ttlMs = 10 * 60 * 1000) { this.max = max; this.ttl = ttlMs; this.map = new Map(); }
  get(k, now = Date.now()) {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (now - hit.at > this.ttl) { this.map.delete(k); return undefined; }
    this.map.delete(k); this.map.set(k, hit);   // most recently used last
    return hit.v;
  }
  set(k, v, now = Date.now()) {
    this.map.delete(k);
    this.map.set(k, { v, at: now });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

const pageCache = new Lru(80);
const READABLE = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;
const BINARY_EXT = /\.(pdf|zip|rar|7z|gz|tgz|exe|apk|dmg|iso|docx?|xlsx?|pptx?|odt|mp3|mp4|m4a|wav|ogg|webm|mov|avi|jpe?g|png|gif|webp|svg|ico)(\?|#|$)/i;

function wikiTitle(url) {
  try {
    const u = new URL(url);
    const m = /^([a-z-]{2,12})\.(?:m\.)?wikipedia\.org$/.exec(u.hostname);
    if (!m || !u.pathname.startsWith('/wiki/')) return null;
    return { lang: m[1], title: decodeURIComponent(u.pathname.slice(6)).replace(/_/g, ' ') };
  } catch { return null; }
}

async function readWikipedia(w, o) {
  const api = `https://${w.lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'plain', redirects: '1', titles: w.title, format: 'json', formatversion: '2' });
  const r = await safeFetch(api, { headers: { 'User-Agent': 'ColonAI/0.5 (https://chat.apparatus.name.ng; Nifelux)', Accept: 'application/json' }, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes, signal: o.signal, fetch: o.fetch, guard: false, maxRedirects: 1 });
  if (r.status !== 200) throw Object.assign(new Error(`http ${r.status}`), { code: `http_${r.status}` });
  const page = (((JSON.parse(r.text) || {}).query || {}).pages || [])[0] || {};
  if (!page.extract) throw Object.assign(new Error('empty'), { code: 'empty' });
  const text = page.extract.replace(/\n{2,}/g, '\n\n').replace(/([^\n])\n(?!\n)/g, '$1\n\n');
  return { title: page.title || w.title, text };
}

/**
 * readPage(url, { query, signal, fetch, lookup, timeoutMs = 6000, maxBytes = 1.5 MB, maxChars = 2500 })
 *   -> { url, title, text, chars }      or throws { code: 'skipped' | 'blocked_url' | 'timeout' | 'http_<n>' | 'empty' | … }
 */
async function readPage(url, o = {}) {
  const maxChars = o.maxChars || 2500;
  const key = `${url}#${maxChars}#${String(o.query || '').slice(0, 200)}`;
  const hit = pageCache.get(key);
  if (hit) return { ...hit, cached: true };
  const opts = { timeoutMs: o.timeoutMs || 6000, maxBytes: o.maxBytes || 1.5 * 1024 * 1024, signal: o.signal, fetch: o.fetch, lookup: o.lookup };
  if (BINARY_EXT.test(url)) throw Object.assign(new Error('not a web page'), { code: 'skipped' });
  let title = '', text = '', finalUrl = url;
  const w = wikiTitle(url);
  if (w) {
    ({ title, text } = await readWikipedia(w, opts));
  } else {
    const r = await safeFetch(url, { ...opts, skip: (type) => Boolean(type) && !READABLE.test(type) });
    if (r.skipped) throw Object.assign(new Error('not a web page'), { code: 'skipped' });
    if (r.status >= 400) throw Object.assign(new Error(`http ${r.status}`), { code: `http_${r.status}` });
    finalUrl = r.url;
    if (/^text\/plain/i.test(r.type)) { text = r.text; title = ''; }
    else ({ title, text } = htmlToText(r.text));
  }
  text = pickRelevant(text, o.query || '', maxChars);
  if (text.length < 80) throw Object.assign(new Error('no readable text'), { code: 'empty' });
  const out = { url: finalUrl, title, text, chars: text.length };
  pageCache.set(key, out);
  return out;
}

/**
 * readMany(results, { count, budgetMs = 12000, ... }) -> Map(url -> page) for the pages that worked.
 * Pages are read in parallel; whatever isn't back when the overall budget runs out is left out.
 */
async function readMany(results, o = {}) {
  const list = results.slice(0, Math.max(0, o.count == null ? 3 : o.count));
  const out = new Map();
  if (!list.length) return out;
  const ctl = new AbortController();
  const onOuter = () => ctl.abort();
  if (o.signal) o.signal.addEventListener('abort', onOuter, { once: true });
  let timer;
  const budget = new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(); }, o.budgetMs || 12000); });
  const jobs = list.map(r => readPage(r.url, { ...o, signal: ctl.signal }).then(p => { out.set(r.url, p); }, (e) => { if (o.onError) o.onError(r.url, e); }));
  await Promise.race([Promise.all(jobs), budget]);
  clearTimeout(timer);
  if (o.signal) o.signal.removeEventListener('abort', onOuter);
  ctl.abort();
  return new Map(out);
}

module.exports = { readPage, readMany, Lru, pageCache, wikiTitle };
