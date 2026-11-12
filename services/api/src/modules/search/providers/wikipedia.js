// Web search provider: Wikipedia (English, plus the Naijá, Yorùbá, Hausa or Igbo Wikipedia). No key.
const { safeFetch } = require('../net');
const { stripTags, keywords } = require('../text');
const { err } = require('./errors');

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

module.exports = { wikipedia, wikiQuery, parseWikiSearch, parseOpenSearch, wikiUrl };
