// Study: CBT practice test (handlers for src/http/routes/study.js).
// POST /study/cbt { subject, topic?, exam, language, avoid? }
//   -> { questions[10], durationSec: 300, exam, subject, topic }
// Open to guests and signed-in users like guest chat. Counts as ONE Study-mode reply against the daily limits
// (given back when no test could be made). Nothing is saved: the app keeps the test in the tab's sessionStorage.
const ai = require('../../ai');
const safety = require('../../safety');
const log = require('../../../shared/logger');
const cbt = require('../cbt');
const { parseQuestions } = require('../parse');
const { tokens, nearAny } = require('../similar');

const BAD_OUTPUT = 'Colon couldn’t put a full test together just now. Please try again in a moment.';
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

// The pieces the handler talks to; tests replace them (no database, no network).
const live = () => ({
  generate: ai.generate,
  isConfigured: ai.isConfigured,
  loadRouting: (db) => ai.dynamic.load(db),
  resolveCounters: (req, mode, db) => ai.limits.resolveCounters(req, mode, db),
  consumeAll: (c, db) => ai.limits.consumeAll(c, db),
  refundAll: (c, db) => ai.limits.refundAll(c, db),
  checkInput: safety.checkInput,
  streamGuard: safety.streamGuard,
  record: (info, db) => ai.calls.record(info, db),
});

/**
 * makeTest({ req, input, cfg, signal, deps, db, rng, guidance, enabled }) -> { questions, attempts }
 * Asks the model up to twice; questions from both answers are pooled (near-duplicates dropped) until there are 10.
 * Each call gets a fresh random focus and the student's earlier stems (input.avoid); the second call also avoids
 * the stems already accepted. Still short after two calls: items held back only for resembling an earlier test fill
 * the gap (never a duplicate within this test). Throws 'bad_output' (502) when there are still fewer than 10.
 */
async function makeTest(o) {
  const d = o.deps;
  const cfg = o.cfg;
  const language = o.input.language;
  const route = cfg.africanLanguages && cfg.africanLanguages.includes(language) ? 'african' : 'study';
  const seen = new Set();
  const accepted = [];
  const held = [];
  const earlier = o.input.avoid || [];
  const avoid = earlier.map(tokens);
  let questions = [];
  let lastError = null;
  let attempts = 0;
  while (attempts < 2 && questions.length < cbt.COUNT) {
    attempts++;
    try {
      const steer = questions.map(q => q.q).concat(earlier).slice(0, cbt.MAX_AVOID);   // this test's first
      const r = await d.generate({ mode: 'study', language, routing: cfg, signal: o.signal,
        messages: [{ role: 'user', content: cbt.userPrompt(o.input, cbt.COUNT, { rng: o.rng, avoid: steer }) }],
        context: [o.guidance, cbt.systemContext()].filter(Boolean).join('\n\n'), temperature: cbt.TEMPERATURE,
        timeouts: cfg.hedge ? { hedge: cfg.hedge } : undefined });
      d.record({ mode: 'study', route, guest: !o.req.user, attempts: r.attempts || [] }, o.db);
      if (d.streamGuard({ enabled: o.enabled }).final(r.text)) { lastError = err(502, 'bad_output', BAD_OUTPUT);
        continue; }
      const got = parseQuestions(r.text, { max: cbt.COUNT - questions.length, seen, rng: o.rng, accepted, avoid,
        held });
      questions = questions.concat(got);
      if (questions.length < cbt.COUNT) log.warn('cbt_short', { attempt: attempts, valid: got.length,
        total: questions.length, held: held.length, chars: String(r.text || '').length });
    } catch (e) {
      if (e.name === 'AbortError' || (o.signal && o.signal.aborted)) throw e;
      d.record({ mode: 'study', route, guest: !o.req.user, attempts: e.attempts || [], code: e.code || 'error' },
        o.db);
      lastError = e;
      if (e.code === 'no_provider' || e.code === 'no_vision') break;
    }
  }
  if (questions.length < cbt.COUNT && held.length) {
    const before = questions.length;
    for (const h of held) {
      if (questions.length >= cbt.COUNT) break;
      if (nearAny(h.fp, accepted)) continue;
      accepted.push(h.fp);
      questions.push(h.item);
    }
    log.warn('cbt_short', { attempt: attempts, fallback: 'avoid_list', added: questions.length - before,
      total: questions.length });
  }
  if (questions.length >= cbt.COUNT) return { questions: questions.slice(0, cbt.COUNT), attempts };
  if (lastError && ['no_provider', 'provider_down'].includes(lastError.code) && !questions.length) {
    throw err(503, lastError.code, lastError.code === 'no_provider'
      ? 'Colon Saga isn’t connected to an AI provider yet.'
      : 'Colon Saga couldn’t reach an AI provider right now. Please try again in a moment.');
  }
  throw err(502, 'bad_output', BAD_OUTPUT);
}

// POST /study/cbt
async function postCbt(req, res, opts = {}) {
  const deps = { ...live(), ...(opts.deps || {}) };
  const db = opts.db;
  const input = cbt.cleanInput(req.body);
  const verdict = await deps.checkInput({ text: [input.subject, input.topic].filter(Boolean).join(' — '), req,
    mode: 'study', language: input.language, route: 'study.cbt', db });
  if (verdict.action === 'refuse') return [422, { error: 'refused', message: verdict.refusal }];
  const cfg = await deps.loadRouting(db);
  if (!deps.isConfigured(cfg)) throw err(503, 'no_provider', 'Colon Saga isn’t connected to an AI provider yet.');
  const counters = await deps.resolveCounters(req, 'study', db);
  await deps.consumeAll(counters, db);
  const ctl = new AbortController();
  let done = false;
  if (res && typeof res.on === 'function') res.on('close', () => { if (!done) ctl.abort(); });
  try {
    const out = await makeTest({ req, input, cfg, signal: ctl.signal, deps, db, rng: opts.rng,
      guidance: verdict.guidance, enabled: verdict.enabled });
    done = true;
    return [200, { questions: out.questions, durationSec: cbt.DURATION_SEC, count: cbt.COUNT, exam: input.exam,
      examLabel: cbt.EXAMS[input.exam].label, subject: input.subject, topic: input.topic }];
  } catch (e) {
    done = true;
    await deps.refundAll(counters, db);
    if (e.name === 'AbortError') throw err(499, 'aborted', 'Cancelled.');
    if ((e.status && e.status < 500) || ['bad_output', 'no_provider', 'provider_down'].includes(e.code)) throw e;
    log.error('cbt_failed', { err: e.message, code: e.code });
    throw err(502, 'bad_output', BAD_OUTPUT);
  }
}

module.exports = { postCbt, makeTest, BAD_OUTPUT };
