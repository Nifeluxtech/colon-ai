// Colon benchmark runner core: loads the sets, asks one candidate model every item through the app's own
// provider client (src/modules/ai/client.js, with Saga's real system prompt per mode and language), grades the reply
// and records timing. The CLI is scripts/bench.js; tests drive this module with a fake fetch.
const fs = require('fs');
const path = require('path');
const { streamChat } = require('../ai').client;
const { systemPrompt } = require('../ai').prompts;
const routing = require('../ai').routing;
const { grade } = require('./graders');
const { CANDIDATES, bodyOf, cfgOf, parseCandidate, keyOf } = require('./candidates');
const retry = require('./retry');

const SETS_DIR = path.resolve(__dirname, '../../../bench/sets');
const SUITE_VERSION = 'colon-bench-1';

// Default answer-format instruction per grader type (an item or set "instruction" overrides it).
const FORMAT = {
  mc: 'Reply with the letter of the correct option only.',
  number: ('Work it out briefly, then end with a final line in the form "Answer: <number>" (the number only, no '
    + 'units or currency sign).'),
  code: ('Reply with only the complete JavaScript code in one ```javascript block (no require/import, no example '
    + 'calls).'),
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** loadSets(dir, only?) -> [{ set, title, mode, language, judge, items:[{ id, set, prompt, grade, mode, language }] }]
   */
function loadSets(dir = SETS_DIR, only = null) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const ids = new Set();
  const out = [];
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!s.set || !Array.isArray(s.items)) throw new Error(`${f}: needs "set" and "items"`);
    if (only && !only.includes(s.set)) continue;
    const items = s.items.map((it) => {
      if (!it.id || !it.prompt || !it.grade) throw new Error(`${f}: every item needs id, prompt and grade`);
      if (ids.has(it.id)) throw new Error(`${f}: duplicate id ${it.id}`);
      ids.add(it.id);
      const instr = it.instruction !== undefined ? it.instruction : s.instruction !== undefined
        ? s.instruction : FORMAT[it.grade.type] || '';
      return { id: it.id, set: s.set, prompt: instr ? `${it.prompt}\n\n${instr}` : it.prompt, grade: it.grade,
        mode: it.mode || s.mode || 'general', language: it.language || s.language || 'en', judge: s.judge || null };
    });
    out.push({ set: s.set, title: s.title || s.set, mode: s.mode || 'general', language: s.language || 'en',
      judge: s.judge || null, items });
  }
  return out;
}

// In the sandbox the host injects provider keys on the wire, so the client's own key headers must not be sent.
// Only the bench runner uses this (BENCH_SANDBOX=1); production code paths never strip headers.
function sandboxFetch(base = globalThis.fetch) {
  return (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
    delete headers.Authorization; delete headers.authorization; delete headers['x-goog-api-key'];
    return base(url, { ...init, headers });
  };
}

function providerConfig(id, overrides = {}) {
  const p = routing.providers()[id];
  if (!p) throw new Error(`Unknown provider "${id}"`);
  return { ...p, ...(overrides[id] || {}), apiKey: (overrides[id] && overrides[id].apiKey) || p.apiKey || 'bench' };
}

const realSleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * runItem(candidate, item, opts) -> result row
 * opts: { fetch, providers (overrides), limiter ({ acquire }), firstTokenTimeoutMs, idleTimeoutMs, maxMs, maxTokens,
 *   temperature, retries, backoffMs, rateRetries, rateBackoffMs, jitter, sleep }. A candidate's own "opts" win.
 * Error rows carry error (one-line reason), error_code, error_status, error_phase and attempt_log.
 */
async function runItem(c, item, opts = {}) {
  const o = { ...opts, ...(c.opts || {}) };
  const sleep = o.sleep || realSleep;
  const provider = providerConfig(c.provider, o.providers);
  const messages = [{ role: 'system', content: systemPrompt({ mode: item.mode, language: item.language }) },
    { role: 'user', content: item.prompt }];
  const state = { errors: 0, limited: 0 };
  const log = [];
  let last = null, waited = 0;
  for (;;) {
    const t0 = Date.now();
    let first = null, release = null, t1 = t0;
    try {
      release = o.limiter ? await o.limiter.acquire() : null;
      t1 = Date.now();                       // time spent waiting for the limiter is not the model's
      const r = await streamChat({
        provider, model: c.model, body: bodyOf(c), messages, fetch: o.fetch,
        maxTokens: o.maxTokens || 2048, temperature: o.temperature,
        firstTokenTimeoutMs: o.firstTokenTimeoutMs || 60000, idleTimeoutMs: o.idleTimeoutMs || 60000,
        maxMs: o.maxMs || 240000,
        onDelta: () => { if (first === null) first = Date.now() - t1; },
      });
      const g = grade(r.text, item.grade);
      const cut = r.finishReason === 'length';
      return {
        set: item.set, id: item.id, pass: g.pass, score: Math.round(g.score * 1000) / 1000, ...(g.lang !== undefined
          ? { lang: Math.round(g.lang * 1000) / 1000 } : {}),
        detail: cut && !g.pass ? `cut off at max_tokens (${o.maxTokens || 2048}) | ${g.detail}` : g.detail,
        first_token_ms: first, total_ms: Date.now() - t1, attempts: log.length + 1, finish: r.finishReason || null,
        ...(waited ? { waited_ms: waited } : {}), ...(log.length ? { attempt_log: log } : {}), cfg: cfgOf(c, o),
        tokens: (r.usage && (r.usage.total_tokens || 0)) || 0, cost_usd: 0, reply: String(r.text).slice(0, 8000),
      };
    } catch (e) {
      last = e;
      const ms = Date.now() - t1;
      log.push({ code: e.code || 'error', ...(e.status ? { status: e.status } : {}), ...(e.phase ? { phase: e.phase }
        : {}), ms });
      const next = retry.nextWait(e, state, o);
      if (!next.retry) break;
      if (next.rate) state.limited++; else state.errors++;
      waited += next.waitMs;
      await sleep(next.waitMs);
    } finally { if (release) release(); }
  }
  const ms = log.length ? log[log.length - 1].ms : 0;
  return { set: item.set, id: item.id, pass: false, score: 0, detail: 'error', first_token_ms: null, total_ms: ms,
    attempts: log.length, error: retry.reason(last, { ms, attempts: log.length }), error_code: last.code || 'error',
    error_status: last.status || 0, ...(last.phase ? { error_phase: last.phase } : {}), attempt_log: log,
    ...(waited ? { waited_ms: waited } : {}), cfg: cfgOf(c, o) };
}

/**
 * runModel(candidate, items, { done: Set(ids), onResult(row), concurrency, gapMs, unreliableAfter, ...runItem opts })
 * -> { rows, unreliable }
 * Stops early (unreliable) when more than half of the first `unreliableAfter` (default 20) results are errors.
 */
async function runModel(c, items, opts = {}) {
  const todo = items.filter(it => !(opts.done && opts.done.has(it.id)));
  const rows = [];
  const prior = opts.prior || [];
  const conc = Math.max(1, Math.min(4, opts.concurrency || 1));
  const after = opts.unreliableAfter || 20;
  let unreliable = false, next = 0;
  const check = () => {
    const all = prior.concat(rows);
    if (all.length >= after && all.filter(r => r.error).length / all.length > 0.5) unreliable = true;
  };
  check();
  async function worker() {
    while (!unreliable && next < todo.length) {
      const it = todo[next++];
      const row = await runItem(c, it, opts);
      rows.push(row);
      if (opts.onResult) opts.onResult(row);
      check();
      if (opts.gapMs) await (opts.sleep || realSleep)(opts.gapMs);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return { rows, unreliable };
}

// Re-grades a stored row from its saved reply with the current graders (after a grader fix, no new API calls).
function regrade(row, item) {
  if (row.error || row.reply === undefined || !item) return row;
  const g = grade(row.reply, item.grade);
  const out = { ...row, pass: g.pass, score: Math.round(g.score * 1000) / 1000, detail: g.detail };
  if (g.lang !== undefined) out.lang = Math.round(g.lang * 1000) / 1000; else delete out.lang;
  return out;
}

/* ---------- Optional LLM judge for the language sets ---------- */
function judgePrompt(languageName, item, reply) {
  return [
    `You are a strict native-speaker examiner for ${languageName}. Rate the ANSWER below from 1 to 5:`,
    ('5 = fluent, natural and correct, fully answers the request; 4 = good with small slips; 3 = understandable but '
      + 'clearly flawed or partly English;'),
    '2 = mostly wrong language or broken; 1 = not in the language or does not answer.',
    `REQUEST: ${item.prompt}`, `ANSWER: ${String(reply || '').slice(0, 1500)}`,
    'Reply with the single digit only.',
  ].join('\n');
}
async function judgeItem(judge, item, row, opts = {}) {
  if (row.error || !item.judge) return null;
  const r = await runItem(judge, { ...item, prompt: judgePrompt(item.judge, item, row.reply), language: 'en',
    mode: 'general', grade: { type: 'regex', pattern: '[1-5]' } }, { ...opts, retries: 1 });
  if (r.error) return null;
  const m = /[1-5]/.exec(r.reply || '');
  return m ? (Number(m[0]) - 1) / 4 : null;
}

module.exports = { loadSets, runItem, regrade, runModel, judgeItem, sandboxFetch, parseCandidate, keyOf, slug,
  CANDIDATES, SUITE_VERSION, SETS_DIR, FORMAT, cfgOf, bodyOf };
