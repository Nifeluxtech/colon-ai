// Web search provider: SearXNG (base URL of your own or a friendly instance; JSON output must be on).
const { safeFetch } = require('../net');
const { stripTags } = require('../text');
const { err } = require('./errors');

/* ---------- SearXNG (your own or a friendly instance; base URL, JSON format must be on) ---------- */
const searxng = {
  id: 'searxng', name: 'SearXNG', needs: 'url',
  async search(query, o = {}) {
    const base = String(o.baseUrl || '').replace(/\/+$/, '');
    const url = `${base}/search?` + new URLSearchParams({ q: query, format: 'json', language: o.lang && o.lang !== 'en'
      && o.lang !== 'pcm' ? o.lang : 'en', safesearch: '1' });
    // A configured instance could be anywhere, so it goes through the SSRF guard like any page.
    const r = await safeFetch(url, { headers: { Accept: 'application/json', ...(o.key
      ? { Authorization: `Bearer ${o.key}` } : {}) }, timeoutMs: o.timeoutMs || 6000, signal: o.signal, fetch: o.fetch,
      lookup: o.lookup, maxBytes: 800 * 1024 });
    if (r.status === 429 || r.status === 403) throw err('blocked', `SearXNG answered ${r.status}`);
    if (r.status !== 200) throw err(`http_${r.status}`);
    let j; try { j = JSON.parse(r.text); } catch { throw err('parse', 'SearXNG JSON output is off on this instance'); }
    return (j.results || []).map(x => ({ title: stripTags(x.title || ''), url: x.url, snippet: stripTags(x.content
      || '') }));
  },
};

module.exports = { searxng };
