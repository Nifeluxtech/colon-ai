// Deep research steps (0.17.0, Blueprint D16): one call = one bounded step of a run, from its saved state.
//   plan    the searches to run (heuristic queries + model-written English queries, at most RESEARCH_MAX_QUERIES)
//   search  one web search (through the tool registry), results merged and de-duplicated
//   read    up to READ_BATCH result pages read (at most RESEARCH_MAX_PAGES in all), readable text kept, trimmed
//   write   the cited report from the question and what was read (the Research mode chain)
// step(run, deps, signal) -> { stage, state } for the next step, or { done: { content, sources, web } }.
// deps: { webSearch(query, signal), readMany(results, o), modelQueries(text, o), buildQueries(text, o),
//         generate(o), contextBlock(o), publicSources(list), routing(), cfg: { maxQueries, maxPages, stepMs }, now() }
const READ_BATCH = 3;
const PAGE_CHARS = 3500;
const MAX_RESULTS = 20;

/** Time a stage needs before a runner may start it (a runner with less left defers the step to the next run). */
function need(stage, cfg) {
  if (stage === 'write') return Number(cfg.stepMs) || 35000;
  return stage === 'read' ? 20000 : 15000;
}

const norm = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '').replace(/^http:/, 'https:')
  .replace('://www.', '://');

function merge(list, more) {
  const seen = new Set(list.map((r) => norm(r.url)));
  for (const r of more || []) {
    if (!r || !/^https?:\/\//i.test(r.url || '') || seen.has(norm(r.url))) continue;
    seen.add(norm(r.url));
    list.push({ title: String(r.title || '').slice(0, 200), url: String(r.url).slice(0, 2000),
      snippet: String(r.snippet || '').slice(0, 400) });
    if (list.length >= MAX_RESULTS) break;
  }
  return list;
}

/** Estimated steps in all, for the progress line (known better once the searches are planned and run). */
function total(state, cfg) {
  const q = (state.queries || []).length || Number(cfg.maxQueries) || 4;
  const pages = Math.min(Number(cfg.maxPages) || 8, (state.results || []).length || Number(cfg.maxPages) || 8);
  return 1 + q + Math.max(1, Math.ceil(pages / READ_BATCH)) + 1;
}

const LABEL = { plan: 'Planning the searches', search: 'Searching the web', read: 'Reading sources',
  write: 'Writing the report', done: 'Done' };

const REPORT = 'Write a well-organised research report that answers the question below. Start with a short '
  + 'summary, then sections with headings, then the key takeaways. Cite the numbered sources inline like [1] for '
  + 'every fact taken from them, say where sources disagree or are missing, and do not invent sources.\n\nQuestion: ';

async function plan(run, d, signal) {
  const cfg = d.cfg;
  const heuristic = d.buildQueries(run.question, { now: d.now() }) || [];
  let model = null;
  try {
    model = await d.modelQueries(run.question, { routing: await d.routing(), signal, now: d.now(), timeoutMs: 8000 });
  } catch (e) { if (e.name === 'AbortError') throw e; model = null; }
  const queries = [];
  for (const q of [...(model || []), ...heuristic, run.question.slice(0, 120)]) {
    const s = String(q || '').trim();
    if (s.length >= 3 && !queries.some((x) => x.toLowerCase() === s.toLowerCase())) queries.push(s);
    if (queries.length >= cfg.maxQueries) break;
  }
  return { stage: 'search', state: { queries, qi: 0, results: [], read: 0, pages: {} } };
}

async function search(run, d, signal) {
  const st = { ...run.state };
  const q = st.queries[st.qi];
  const got = q ? await d.webSearch(q, signal) : [];
  st.results = merge(st.results || [], got);
  st.qi = (st.qi || 0) + 1;
  return { stage: st.qi < st.queries.length ? 'search' : 'read', state: st };
}

async function read(run, d, signal) {
  const st = { ...run.state, pages: { ...(run.state.pages || {}) } };
  const upto = Math.min(d.cfg.maxPages, (st.results || []).length);
  const batch = st.results.slice(st.read || 0, Math.min(upto, (st.read || 0) + READ_BATCH));
  if (batch.length) {
    const pages = await d.readMany(batch, { count: batch.length, query: st.queries.join(' '), signal,
      budgetMs: 15000, timeoutMs: 7000 });
    for (const r of batch) {
      const p = pages && pages.get ? pages.get(r.url) : null;
      st.pages[r.url] = p ? { title: String(p.title || '').slice(0, 200), text: String(p.text || '')
        .slice(0, PAGE_CHARS) } : null;
    }
  }
  st.read = (st.read || 0) + batch.length;
  return { stage: st.read < upto ? 'read' : 'write', state: st };
}

async function write(run, d, signal) {
  const st = run.state || {};
  const pages = st.pages || {};
  const sources = (st.results || []).slice(0, d.cfg.maxPages + 2).map((r, i) => {
    const p = pages[r.url];
    let site = '';
    try { site = new URL(r.url).hostname.replace(/^www\./, ''); } catch { site = ''; }
    return { n: i + 1, title: (p && p.title) || r.title || site, url: r.url, site, snippet: r.snippet || '',
      text: p ? p.text : undefined };
  });
  const ok = sources.length > 0;
  const g = await d.generate({ mode: 'research', language: run.language || 'en', routing: await d.routing(), signal,
    messages: [{ role: 'user', content: REPORT + run.question }], web: ok, taskText: run.question,
    context: d.contextBlock({ sources, failed: !ok, now: d.now() }), onDelta: () => {},
    timeouts: { maxReplyMs: Math.max(5000, d.cfg.stepMs - 2000), maxTokens: 4096 } });
  const read = Object.values(pages).filter(Boolean).length;
  const content = String(g.text || '').trim();
  if (!content) throw Object.assign(new Error('The report came back empty.'), { code: 'empty' });
  return { done: { content, sources: ok ? d.publicSources(sources) : [],
    web: { ok, provider: 'deep_research', ms: 0, read }, providerId: g.providerId, model: g.model } };
}

const STEPS = { plan, search, read, write };

async function step(run, deps, signal) {
  const fn = STEPS[run.stage];
  if (!fn) throw Object.assign(new Error(`unknown stage ${run.stage}`), { code: 'bad_stage', permanent: true });
  return fn(run, deps, signal);
}

module.exports = { step, need, total, merge, LABEL, READ_BATCH, PAGE_CHARS, REPORT };
