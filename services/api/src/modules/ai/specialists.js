// Specialist routing (Phase 5, v0.5.10): per task category, which model slot leads the chain, derived from the
// last imported Colon benchmark (bench/results/<run>.eval.json -> POST /admin/evaluation/bench -> eval_runs).
//
// Rule (pure, re-derived whenever a new benchmark is imported):
//   - the default is the first slot of the category's reference route (e.g. "gemma" for Hausa via "african");
//   - a specialist replaces it only when it is COMPLETE in the bench (status done) and beats the default in that
//     category by MARGIN points plus a latency penalty (LATENCY_POINTS_PER_S per second of extra median first
//     token), and its median first token there is at most MAX_FIRST_TOKEN_MS;
//   - complete slots scoring under WEAK_FLOOR in the category are demoted to the tail of the chain (never removed),
//     and NEVER_HEAD keeps MiniMax out of the head for Yorùbá, Hausa and Igbo whatever a later bench says;
//   - nothing is ever dropped: the specialist only reorders the head, fallback and hedging stay as they were.
// With no imported benchmark the STATIC table (the same rule run on bench 2026-11-12) is used.
const MARGIN = 5;
const LATENCY_POINTS_PER_S = 0.5;
const MAX_FIRST_TOKEN_MS = 15000;
const WEAK_FLOOR = 70;

// Category -> benchmark sets (scores are the mean accuracy over the sets, in %, errors counting 0 as in the report).
const SETS = {
  code: ['coding'], reasoning: ['reasoning'], exam: ['waec', 'jamb', 'university'], research: ['tooluse'],
  everyday: ['everyday'], pidgin: ['pidgin'], yoruba: ['yoruba'], hausa: ['hausa'], igbo: ['igbo'],
};
// Category -> the route it is judged against (the route a typical request of that kind uses).
const REFERENCE_ROUTE = {
  code: 'developer', reasoning: 'general', exam: 'study', research: 'research', everyday: 'general',
  pidgin: 'african', yoruba: 'african', hausa: 'african', igbo: 'african',
};
const NEVER_HEAD = { yoruba: ['minimax'], hausa: ['minimax'], igbo: ['minimax'] };
const CATEGORIES = Object.keys(SETS);

// Built-in result of derive() on bench/results/2026-11-12.eval.json with the routing.js defaults
// (tests/unit/specialists.test.js checks the two still agree).
const STATIC = {
  source: 'static', bench: 'Colon benchmark 2026-11-12 (built in)',
  categories: {
    code: { specialist: null, demoted: [] },
    reasoning: { specialist: null, demoted: [] },
    exam: { specialist: null, demoted: [] },
    research: { specialist: null, demoted: [] },
    everyday: { specialist: 'minimax', demoted: [] },
    pidgin: { specialist: null, demoted: [] },
    yoruba: { specialist: null, demoted: ['minimax'] },
    hausa: { specialist: null, demoted: ['minimax'] },
    igbo: { specialist: null, demoted: ['minimax'] },
  },
};

const parse = (v) => {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || 'null'); } catch { return null; }
};
const round1 = (x) => Math.round(x * 10) / 10;

// One bench row's score and median first token (ms) in a category; null when a set is missing.
function categoryStats(row, category) {
  const details = parse(row && row.details);
  const sets = details && details.sets;
  if (!sets) return null;
  const list = SETS[category].map(s => sets[s]);
  if (list.some(s => !s || !Number.isFinite(Number(s.accuracy)))) return null;
  const score = round1(100 * list.reduce((a, s) => a + Number(s.accuracy), 0) / list.length);
  const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  const ms = list.map(s => num(s.first_token_ms && s.first_token_ms.median)).filter(x => x !== null);
  const median = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : num(row.first_token_ms);
  return { score, ms: median };
}

/**
 * derive(runs, { routes, targets, margin?, latencyPointsPerS?, maxFirstTokenMs?, weakFloor? })
 *   runs: eval_runs-like rows of ONE benchmark import { provider, model, status, details, first_token_ms }
 *   -> { source: 'bench', bench, categories: { <category>: { route, default, specialist, demoted, required,
 *        scores: { <slot>: { score, ms, complete } }, reason } } }   or null when no row has per-set data.
 */
function derive(runs, opts = {}) {
  const { routes, targets } = opts;
  const margin = opts.margin ?? MARGIN, perS = opts.latencyPointsPerS ?? LATENCY_POINTS_PER_S;
  const maxMs = opts.maxFirstTokenMs ?? MAX_FIRST_TOKEN_MS, floor = opts.weakFloor ?? WEAK_FLOOR;
  const rows = (runs || []).filter(r => r && parse(r.details) && parse(r.details).sets);
  if (!rows.length) return null;
  const byKey = new Map();   // newest row wins when a model appears twice
  for (const r of rows) if (!byKey.has(`${r.provider}|${r.model}`)) byKey.set(`${r.provider}|${r.model}`, r);
  // A slot is judged by its first provider+model pair that was benchmarked.
  const rowFor = (slot) => (targets[slot] || []).map(t => byKey.get(`${t.provider}|${t.model}`)).find(Boolean);
  const categories = {};
  for (const category of CATEGORIES) {
    const route = REFERENCE_ROUTE[category];
    const names = routes[route] || routes.general || [];
    const scores = {};
    for (const slot of names) {
      const row = rowFor(slot);
      const st = row && categoryStats(row, category);
      if (st) scores[slot] = { ...st, complete: row.status === 'done' };
    }
    const def = names[0], d = scores[def];
    const never = NEVER_HEAD[category] || [];
    const demoted = names.filter(n => n !== def && (never.includes(n) || (scores[n] && scores[n].complete
      && scores[n].score < floor)));
    let specialist = null, required = null, reason;
    if (!d || !d.complete) reason = `default ${def || '-'} has no complete benchmark in this category`;
    else {
      const pick0 = names.filter(n => n !== def && scores[n] && scores[n].complete && !never.includes(n)
        && !demoted.includes(n))
        .map(n => {
          const s = scores[n];
          const slower = s.ms !== null && d.ms !== null ? Math.max(0, s.ms - d.ms) / 1000 : 0;
          return { n, s, need: round1(d.score + margin + perS * slower) };
        })
        .sort((a, b) => (b.s.score - a.s.score) || ((a.s.ms ?? Infinity) - (b.s.ms ?? Infinity)));
      const fast = (c) => c.s.ms === null || c.s.ms <= maxMs;
      const pick = pick0.find(c => c.s.score >= c.need && fast(c));
      if (pick) {
        specialist = pick.n; required = pick.need;
        reason = `${pick.n} ${pick.s.score} vs ${def} ${d.score} (needed ${pick.need})`;
      } else {
        const near = pick0.find(c => c.s.score >= d.score + margin);
        reason = near ? `${near.n} ${near.s.score} beats ${def} ${d.score} but is too slow (median first token `
          + `${(near.s.ms / 1000).toFixed(1)} s: needed ${near.need}${fast(near) ? '' : `, over ${maxMs / 1000} s`})`
          : `no complete slot beats ${def} ${d.score} by ${margin}+ points`;
      }
    }
    categories[category] = { route, default: def || null, specialist, demoted, required, scores, reason };
  }
  const named = rows.find(r => r.name);
  return { source: 'bench', bench: named ? named.name : 'imported benchmark', categories };
}

/**
 * apply(names, decision) -> reordered copy of a route's slot list: the specialist (when it is in the list) moves to
 * the front, demoted slots move to the back. Nothing is added or removed.
 */
function apply(names, decision) {
  if (!decision) return names.slice();
  let out = names.slice();
  if (decision.specialist && out.includes(decision.specialist)) {
    out = [decision.specialist, ...out.filter(n => n !== decision.specialist)];
  }
  const down = (decision.demoted || []).filter(n => out.includes(n) && n !== out[0]);
  return out.filter(n => !down.includes(n)).concat(down);
}

// The specialist table in force for a routing config: derived from its imported bench, else the static table.
const tableFor = (cfg) => (cfg && cfg.specialists) || STATIC;

// On/off: the Admin "routing" setting wins, then AI_SPECIALIST_ROUTING (default on).
function enabledFor(cfg, envValue = process.env.AI_SPECIALIST_ROUTING) {
  if (cfg && typeof cfg.specialistRouting === 'boolean') return cfg.specialistRouting;
  return String(envValue || 'on').toLowerCase() !== 'off';
}

module.exports = { derive, apply, tableFor, enabledFor, categoryStats, STATIC, SETS, REFERENCE_ROUTE, NEVER_HEAD,
  CATEGORIES, MARGIN, LATENCY_POINTS_PER_S, MAX_FIRST_TOKEN_MS, WEAK_FLOOR };
