// Live check of Research mode: web search + page reader + a full answer through the real model router,
// printed with timings (time to sources, time to the first answer token, total) and the cited sources.
// Nothing is saved; no database needed (the defaults chain DuckDuckGo → Wikipedia, plus any keys in the env).
//
//   node scripts/research-check.js "What is the current CBN monetary policy rate?" [language]
//   BENCH_SANDBOX=1 drops the client's own key headers on model calls (sandbox key injection only, as in bench.js).
const { respond } = require('../src/modules/chat/reply');
const { createParser } = require('../src/modules/ai/sse');
const { EventEmitter } = require('events');

const question = process.argv[2] || 'What is the current CBN monetary policy rate?';
const language = process.argv[3] || 'en';
const sandbox = process.env.BENCH_SANDBOX === '1' ? require('../src/modules/bench/runner').sandboxFetch() : undefined;

const res = new EventEmitter();
Object.assign(res, { writableEnded: false, socket: null, writeHead() {}, end() { this.writableEnded = true; } });
const t0 = Date.now();
const marks = {};
let answer = '', sources = [];
const parser = createParser((e) => {
  const d = JSON.parse(e.data);
  const ms = Date.now() - t0;
  if (e.event === 'status') console.log(`${String(ms).padStart(6)} ms  status ${d.stage}${d.count ? ' ' + d.count : ''}`);
  if (e.event === 'sources') { marks.sources = ms; sources = d.sources; console.log(`${String(ms).padStart(6)} ms  sources ${d.sources.length}`); }
  if (e.event === 'delta') { if (marks.first == null && !/^_Web search wasn/.test(d.text)) { marks.first = ms; console.log(`${String(ms).padStart(6)} ms  first answer token`); } answer += d.text; }
  if (e.event === 'error') console.log(`${String(ms).padStart(6)} ms  ERROR ${d.code}: ${d.message}`);
  if (e.event === 'done') { marks.done = ms; console.log(`${String(ms).padStart(6)} ms  done (${d.message.status})`); }
});
res.write = (c) => { parser.push(String(c)); return true; };

const store = { async start() { return { id: 'check', role: 'assistant', content: '', status: 'streaming' }; }, async finish(x) { store.saved = x; return { id: 'check', ...x }; } };

(async () => {
  const routing = require('../src/modules/ai/routing');
  await respond({
    req: { user: null }, res, mode: 'research', language, history: [{ role: 'user', content: question }], counters: [], store,
    routing, fetch: sandbox, webSearch: true, searchText: question,
  });
  parser.end();
  console.log('\n--- answer (' + ((store.saved && store.saved.providerId) || '?') + ' / ' + ((store.saved && store.saved.providerModel) || '?') + ') ---\n' + answer.trim());
  console.log('\n--- sources ---');
  for (const s of sources) console.log(`[${s.n}] ${s.title} — ${s.url}`);
  const cited = [...new Set((answer.match(/\[(\d{1,2})\]/g) || []).map(x => Number(x.slice(1, -1))))].sort((a, b) => a - b);
  const bad = cited.filter(n => !sources.some(s => s.n === n));
  console.log(`\ncited: [${cited.join(', ')}]${bad.length ? `  NOT IN SOURCES: [${bad.join(', ')}]` : '  (all cited numbers exist)'}`);
  console.log(JSON.stringify({ time_to_sources_ms: marks.sources ?? null, time_to_first_token_ms: marks.first ?? null, total_ms: marks.done ?? null, web: store.saved && store.saved.web }));
})().catch((e) => { console.error(e); process.exit(1); });
