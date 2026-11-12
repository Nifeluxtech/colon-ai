// Web search provider: DuckDuckGo (html endpoint, lite as a second try). No key.
const { safeFetch } = require('../net');
const { stripTags, decodeEntities } = require('../text');
const { err } = require('./errors');

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

module.exports = { duckduckgo, parseDdgHtml, parseDdgLite, unwrapDdg, isDdgBlocked };
