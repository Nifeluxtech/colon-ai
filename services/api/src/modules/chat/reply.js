// Streams one assistant reply to the app as server-sent events (the format chat-data.js parses):
//   start {message} → delta {text}… → done {message}     or     error {code, message}
// Research mode with web search (Phase 5) adds, before the first delta:
//   status {stage:'searching'} → status {stage:'reading', count} → sources {sources} → status {stage:'writing'}
//   or, when search fails: status {stage:'unavailable'} and a one-line notice as the first delta (chat never breaks).
// Used by send, regenerate and edit (saved to MySQL) and by guest chat (nothing saved).
// Stop: the app closes the request (we abort the provider call and keep the partial reply as 'stopped');
// POST …/stop does the same from another request, even when a different worker holds the stream.
const ai = require('../ai');
const dynamic = require('../ai').dynamic;
const calls = require('../ai').calls;
const limits = require('../ai').limits;
const sseLib = require('../ai').sse;
const webSearch = require('../search');
const { SECURITY_HEADERS } = require('../../shared/security-headers');
const log = require('../../shared/logger');

const active = new Map(); // message id -> AbortController (this worker only)

function openStream(res) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no',     // Passenger/nginx: don't buffer the stream
    Connection: 'keep-alive',
  });
  if (res.socket) res.socket.setNoDelay(true);
  // ~2 KB of padding so proxies that buffer small responses start flushing straight away.
  res.write(`: ${' '.repeat(2048)}\n\n`);
  return sseLib.writer(res);
}

/**
 * respond({ req, res, mode, model, language, name, history, counters, store, onOpen(sse)? })
 *   counters: daily-limit counters to charge ([{ subject, limit }], see ai/limits.js countersFor)
 *   store.start()                 -> message object sent in "start" (status 'streaming')
 *   webSearch, searchText, searchPrevious   Research mode: search the web for searchText first (see src/modules/search)
 * store.finish(result) -> final message sent in "done" ({ content, status, error, providerId, providerModel, sources,
 * web })
 *   store.isStopped()             -> optional: true when another request asked to stop this reply
 */
async function respond(o) {
  const { req, res, store } = o;
  const sse = openStream(res);
  const ctl = new AbortController();
  let finished = false;
  res.on('close', () => { if (!finished) ctl.abort(); });
  const ping = setInterval(() => sse.comment(), 15000);
  let poll = null;
  let message = null;
  let text = '';
  let prefix = '';     // the "web search unavailable" notice, kept at the top of the saved answer
  let web = null;      // { ok, sources, provider, ms, read } when Research mode searched
  const saved = () => (web ? { sources: web.ok ? webSearch.publicSources(web.sources) : [], web: webMeta(web) } : {});
  try {
    if (o.onOpen) await o.onOpen(sse);
    message = await store.start();
    active.set(message.id, ctl);
    sse.send('start', { message });
    if (store.isStopped) {
      poll = setInterval(() => { store.isStopped().then(s => { if (s) ctl.abort(); }).catch(() => {}); }, 2000);
    }
    // Live routing from the Admin Dashboard (cached ~30 s); routing.js defaults when the database has none.
    const cfg = o.routing || await dynamic.load(o.db);
    const route = cfg.africanLanguages.includes(o.language) ? 'african' : (o.mode || 'general');
    const logCalls = (attempts, code) => { if (!o.routing) calls.record({ mode: o.mode, route, guest: !req.user,
      attempts: attempts || [], code }, o.db); };
    if (!ai.isConfigured(cfg)) { logCalls([], 'no_provider'); throw Object.assign(new Error(
      'Colon Saga isn’t connected to an AI provider yet.'), { code: 'no_provider' }); }
    await limits.consumeAll(o.counters, o.db);
    // Research mode: search and read pages first. Never fatal: on failure the answer streams with a notice.
    if (o.webSearch) {
      web = await searchFirst(o, sse, ctl.signal, cfg);
      if (web && !web.ok) { prefix = UNAVAILABLE; text = prefix; sse.send('delta', { text: prefix }); }
    }
    let result;
    try {
      result = await ai.generate({
        mode: o.mode, language: o.language, model: o.model, name: o.name, messages: o.history, signal: ctl.signal,
          routing: cfg, fetch: o.fetch,
        web: Boolean(web && web.ok), context: web ? webSearch.contextBlock({ sources: web.sources, failed: !web.ok,
          now: o.now }) : '',
        timeouts: cfg.hedge ? { ...(o.timeouts || {}), hedge: cfg.hedge } : o.timeouts,
        onDelta: (piece) => { text += piece; sse.send('delta', { text: piece }); },
      });
      logCalls(result.attempts);
    } catch (e) {
      if (e.name !== 'AbortError') logCalls(e.attempts, e.code || 'error');
      if (e.code === 'no_provider' || e.code === 'no_vision' || (e.code === 'provider_down'
        && !e.partial)) await limits.refundAll(o.counters, o.db);
      throw e;
    }
    finished = true;
    const final = await store.finish({ content: prefix + result.text, status: 'complete',
      providerId: result.providerId, providerModel: result.model, ...saved() });
    sse.send('done', { message: final });
  } catch (e) {
    finished = true;
    if (e.name === 'AbortError') {
      const final = message ? await store.finish({ content: e.partialText != null ? prefix + e.partialText : text,
        status: 'stopped', providerId: e.providerId, providerModel: e.model, ...saved() }).catch(() => null) : null;
      if (final) sse.send('done', { message: final });
    } else {
      const known = ['no_provider', 'quota', 'provider_down', 'no_vision'];
      const code = known.includes(e.code) ? e.code : 'provider_down';
      const msg = known.includes(e.code) ? e.message : 'Something went wrong while answering. Please try again.';
      if (!known.includes(e.code)) log.error('chat_reply_failed', { err: e.message, code: e.code });
      if (message) await store.finish({ content: e.partialText != null ? prefix + e.partialText : text,
        status: 'error', error: { code, message: msg }, providerId: e.providerId, providerModel: e.model,
        ...saved() }).catch((err) => log.error('chat_finish_failed', { err: err.message }));
      sse.send('error', { code, message: msg });
    }
  } finally {
    clearInterval(ping); clearInterval(poll);
    if (message) active.delete(message.id);
    sse.end();
  }
}

const UNAVAILABLE =
  '_Web search wasn’t available just now, so this answer comes from Colon’s own knowledge and may be out of date._\n\n';
const webMeta = (w) => ({ ok: Boolean(w.ok), provider: w.provider || null, ms: w.ms || 0, read: w.read || 0 });

// Runs the web search for Research mode and tells the app what is happening.
// -> null (search switched off, or nothing to search for) | { ok:true, sources, … } | { ok:false }
async function searchFirst(o, sse, signal, routing) {
  const impl = o.searchImpl || webSearch;
  const started = Date.now();
  let r;
  try {
    r = await impl.research({
      text: o.searchText, previous: o.searchPrevious, language: o.language, signal, routing, db: o.db, cfg: o.searchCfg,
      fetch: o.searchFetch, modelFetch: o.fetch, now: o.now,
      onStatus: (s) => sse.send('status', s),
    });
  } catch (e) {
    if (e.name === 'AbortError' || (signal && signal.aborted)) { const a = new Error('aborted'); a.name = 'AbortError';
      a.partialText = ''; throw a; }
    log.warn('search_failed', { provider: 'all', ms: Date.now() - started, code: e.code || 'error',
      err: String(e.message || '').slice(0, 160) });
    r = { ok: false, ms: Date.now() - started };
  }
  if (!r || r.skipped || r.reason === 'no_query') return null;
  if (r.ok && r.sources && r.sources.length) {
    sse.send('sources', { sources: webSearch.publicSources(r.sources) });
    sse.send('status', { stage: 'writing' });
    return { ok: true, sources: r.sources, provider: r.provider, ms: r.ms, read: r.read };
  }
  sse.send('status', { stage: 'unavailable' });
  return { ok: false, sources: [], ms: r.ms };
}

// Stops a reply streaming in this worker. Returns false when another worker holds it.
function stopLocal(messageId) {
  const ctl = active.get(messageId);
  if (!ctl) return false;
  ctl.abort();
  return true;
}

module.exports = { respond, openStream, stopLocal, UNAVAILABLE, _active: active };
