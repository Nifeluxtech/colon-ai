// Web search for Research mode (Phase 5): pluggable providers, a fallback chain, a page reader and the
// orchestration chat/reply.js runs before the model answers. How it works, limits and privacy:
// docs/phase-5-research.md.
//
//   search(query, { limit, lang, signal })  -> [{ title, url, snippet }]   (the configured chain, first that answers)
//   research({ text, previous, language, signal, onStatus, routing, db }) -> { ok, sources, provider, queries, ms, read }
const { PROVIDERS } = require('./providers');
const { readMany } = require('./reader');
const { buildQueries, contextBlock, siteOf, todayLagos } = require('./prompt');
const searchConfig = require('./config');
const log = require('../lib/logger');

// Per-worker rest: a provider that showed a captcha is skipped for 10 minutes, one that errored for 1 minute.
const resting = new Map();
const REST_MS = { blocked: 10 * 60e3, auth: 10 * 60e3, default: 60e3 };

const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.toString().replace(/\/$/, '').replace(/^http:/, 'https:').replace('://www.', '://'); } catch { return ''; } };

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!r || !/^https?:\/\//i.test(r.url || '')) continue;
    const k = normUrl(r.url);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ title: String(r.title || '').trim().slice(0, 200) || siteOf(r.url), url: String(r.url).slice(0, 2000), snippet: String(r.snippet || '').trim().slice(0, 600) });
  }
  return out;
}

/**
 * runChain(queries, { cfg, limit, lang, localQuery, signal, fetch, lookup, now }) -> { results, provider, tried }
 * Tries each ready provider in order; within one provider, the second query only runs when the first
 * didn't fill the list. A provider that fails or finds nothing hands over to the next one.
 */
async function runChain(queries, o) {
  const cfg = o.cfg;
  const limit = o.limit || cfg.results || 5;
  const tried = [];
  const now = o.now || Date.now();
  const ready = cfg.providers.filter(p => p.ready);
  const awake = ready.filter(p => !(resting.get(p.id) > now));
  const order = awake.length ? awake.concat(ready.filter(p => resting.get(p.id) > now)) : ready;
  for (const p of order) {
    if (o.signal && o.signal.aborted) break;
    const impl = o.providers && o.providers[p.id] || PROVIDERS[p.id];
    const started = Date.now();
    let results = [];
    try {
      for (const q of queries) {
        const got = await impl.search(q, { limit, lang: o.lang, localQuery: o.localQuery, signal: o.signal, fetch: o.fetch, lookup: o.lookup, key: p.key, baseUrl: p.baseUrl });
        results = dedupe(results.concat(got));
        if (results.length >= Math.min(limit, 4)) break;
      }
      const ms = Date.now() - started;
      if (results.length) {
        resting.delete(p.id);
        tried.push({ provider: p.id, ok: true, ms, count: results.length });
        return { results: results.slice(0, limit), provider: p.id, tried };
      }
      tried.push({ provider: p.id, ok: false, code: 'no_results', ms });
    } catch (e) {
      if (e.name === 'AbortError' || e.code === 'aborted') throw e;
      const ms = Date.now() - started;
      const code = e.code || 'error';
      tried.push({ provider: p.id, ok: false, code, ms });
      resting.set(p.id, Date.now() + (REST_MS[code] || REST_MS.default));
      log.warn('search_failed', { provider: p.id, ms, code, err: String(e.message || '').slice(0, 120) });
    }
  }
  return { results: [], provider: null, tried };
}

async function search(query, o = {}) {
  const cfg = o.cfg || await searchConfig.load(o.db);
  const r = await runChain([query], { ...o, cfg, limit: o.limit || cfg.results });
  return r.results;
}

// Optional: a quick model call that turns a Naijá/Yorùbá/Hausa/Igbo (or long, rambling) question into short
// English search queries. Budget ~4 s; any problem means the heuristic queries are used instead.
async function modelQueries(text, { routing, signal, fetch, now = new Date(), timeoutMs = 4000 } = {}) {
  if (!routing) return null;
  const ai = require('../ai');
  const { streamChat } = require('../ai/client');
  const chain = ai.chainFor({ mode: 'general', language: 'en' }, routing).slice(0, 1);
  if (!chain.length) return null;
  const c = chain[0];
  const ctl = new AbortController();
  const onOuter = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onOuter, { once: true });
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let out = '';
  try {
    await streamChat({
      provider: c.provider, model: c.model, body: c.body, signal: ctl.signal, fetch, maxTokens: 120, temperature: 0.1,
      firstTokenTimeoutMs: timeoutMs, idleTimeoutMs: timeoutMs, maxMs: timeoutMs,
      messages: [
        { role: 'system', content: `You turn a question (often in Nigerian Pidgin, Yorùbá, Hausa or Igbo) into English web search queries. Today is ${todayLagos(now)}. The user is most likely in Nigeria.\nReply in exactly this format and nothing else:\nEN: <a faithful, word-for-word-accurate English translation of the question>\nQ: <a short English search query, at most 8 words>\nQ: <an optional second query for another part of the question>\nKeep names, places and numbers. Add the year only when the question asks for current or recent information.` },
        { role: 'user', content: String(text).slice(0, 1500) },
      ],
      onDelta: (p) => { out += p; },
    });
  } catch { return null; } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuter);
  }
  const tidy = (l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^(?:EN|Q)\s*:\s*/i, '').replace(/^["'“]|["'”]$/g, '').trim();
  const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
  const qs = lines.filter(l => /^Q\s*:/i.test(l)).map(tidy).filter(l => l.length >= 3 && l.length <= 120);
  const en = lines.filter(l => /^EN\s*:/i.test(l)).map(tidy)[0];
  // The queries first; the faithful translation backs them up when the queries drift from the question.
  const list = (qs.length ? qs.slice(0, 2) : lines.map(tidy).filter(l => l.length >= 3 && l.length <= 120).slice(0, 2));
  if (en && en.length <= 200 && !list.some(q => q.toLowerCase() === en.toLowerCase())) list.splice(1, 0, en.replace(/[?!.]+$/, ''));
  return list.length ? list.slice(0, 3) : null;
}

const NON_ENGLISH = (lang, text) => (lang && lang !== 'en') || /[ẹọṣɓɗƙƴịụṅ]|[àáèéìíòóùú].*[àáèéìíòóùú]/i.test(String(text || ''));

/**
 * research({ text, previous, language, signal, onStatus, routing, db, fetch, lookup, now, cfg })
 *   -> { ok, skipped?, sources: [{ n, title, url, site, snippet, text? }], provider, queries, ms, read, tried }
 * Never throws for search problems (ok:false instead); only a user Stop (AbortError) propagates.
 */
async function research(o) {
  const started = Date.now();
  const cfg = o.cfg || await searchConfig.load(o.db);
  if (!cfg.enabled) return { ok: false, skipped: true, sources: [] };
  const status = o.onStatus || (() => {});
  status({ stage: 'searching' });
  let queries = buildQueries(o.text, { previous: o.previous, now: o.now || new Date() });
  const localQuery = queries[0];
  let via = 'heuristic';
  if (queries.length && NON_ENGLISH(o.language, o.text)) {
    const mq = await modelQueries(o.text, { routing: o.routing, signal: o.signal, fetch: o.modelFetch || o.fetch, now: o.now });
    if (mq) { queries = mq; via = 'model'; }
  }
  if (!queries.length) return { ok: false, sources: [], queries, ms: Date.now() - started, reason: 'no_query' };
  const chain = await runChain(queries, { cfg, limit: cfg.results, lang: o.language, localQuery, signal: o.signal, fetch: o.fetch, lookup: o.lookup, providers: o.providers });
  if (!chain.results.length) {
    log.warn('search_failed', { provider: 'all', ms: Date.now() - started, count: 0, tried: chain.tried.map(t => `${t.provider}:${t.code || 'ok'}`).join(',') });
    return { ok: false, sources: [], queries, ms: Date.now() - started, tried: chain.tried, reason: 'no_results' };
  }
  const toRead = Math.min(cfg.pages, chain.results.length);
  if (toRead) status({ stage: 'reading', count: toRead });
  const query = queries.join(' ');
  const pages = toRead ? await readMany(chain.results, { count: toRead, query, signal: o.signal, fetch: o.fetch, lookup: o.lookup, budgetMs: o.readBudgetMs || 12000, timeoutMs: o.pageTimeoutMs || 6000 }) : new Map();
  if (o.signal && o.signal.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; throw a; }
  const sources = chain.results.map((r, i) => {
    const page = pages.get(r.url);
    return { n: i + 1, title: (page && page.title) || r.title, url: r.url, site: siteOf(r.url), snippet: r.snippet.slice(0, 300), text: page ? page.text : undefined };
  });
  const ms = Date.now() - started;
  log.warn('search_ok', { provider: chain.provider, ms, count: sources.length, read: pages.size, queries: queries.length, via });
  return { ok: true, sources, provider: chain.provider, queries, ms, read: pages.size, tried: chain.tried, via };
}

// What the app and the database get: no page text, just enough to show and link each source.
const publicSources = (sources) => (sources || []).map(s => ({ n: s.n, title: s.title, url: s.url, site: s.site, snippet: s.snippet || '' }));

module.exports = { search, research, runChain, modelQueries, contextBlock, publicSources, dedupe, config: searchConfig, PROVIDERS, _resting: resting };
