// Web search provider: Brave Search API (key).
const { safeFetch } = require('../net');
const { stripTags } = require('../text');
const { err } = require('./errors');

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

module.exports = { brave };
