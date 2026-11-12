// Web search providers, all behind one interface:
//   provider.search(query, { limit, lang, signal, fetch, key, baseUrl }) -> [{ title, url, snippet }]
// Errors carry .code: 'blocked' (captcha / anomaly page / 403 / 429), 'http_<status>', 'timeout', 'network', 'parse'.
//
// Keyless (default chain): DuckDuckGo HTML (lite as a second try), then Wikipedia (English, plus the Naijá,
// Yorùbá, Hausa or Igbo Wikipedia when the reply is in that language). Keyed, only when configured: Brave
// Search API, Tavily, and a SearXNG instance (base URL). Nothing here needs an account to work.
const { duckduckgo, parseDdgHtml, parseDdgLite, unwrapDdg, isDdgBlocked } = require('./duckduckgo');
const { wikipedia, wikiQuery, parseWikiSearch, parseOpenSearch, wikiUrl } = require('./wikipedia');
const { brave } = require('./brave');
const { tavily } = require('./tavily');
const { searxng } = require('./searxng');

// Order of keys = the default order shown in Admin > Web search.
const PROVIDERS = { brave, tavily, searxng, duckduckgo, wikipedia };

module.exports = { PROVIDERS, wikiQuery, parseDdgHtml, parseDdgLite, unwrapDdg, isDdgBlocked, parseWikiSearch, parseOpenSearch, wikiUrl };
