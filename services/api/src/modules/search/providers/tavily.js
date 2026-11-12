// Web search provider: Tavily (key).
const { safeFetch } = require('../net');
const { err } = require('./errors');

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

module.exports = { tavily };
