// Colon benchmark: builds the run report (JSON + Markdown) from per-item rows, and the eval_runs rows that
// put a run on Admin › Evaluation (used by `npm run bench -- --save` and POST /admin/evaluation/bench).
const { aggregate, rank } = require('./aggregate');

const SET_ORDER = ['everyday', 'waec', 'jamb', 'university', 'coding', 'reasoning', 'tooluse', 'pidgin', 'yoruba',
  'hausa', 'igbo'];
const SET_LABEL = { everyday: 'Everyday', waec: 'WAEC', jamb: 'JAMB', university: 'Uni', coding: 'Code',
  reasoning: 'Reason', tooluse: 'Tools', pidgin: 'Pidgin', yoruba: 'Yorùbá', hausa: 'Hausa', igbo: 'Igbo' };

/**
 * buildReport({ run, suite, started, finished, settings, models: [{ provider, model, note, rows, unreliable, failed,
 * expected }] }). failed = the reason a model was stopped for good (wrong key or model id).
 */
function buildReport({ run, suite, started, finished, settings = {}, models }) {
  const out = models.map((m) => {
    const agg = aggregate(m.rows);
    const status = m.failed ? 'failed' : m.unreliable ? 'unreliable' : (m.expected && m.rows.length < m.expected
      ? 'incomplete' : 'done');
    return { key: `${m.provider}:${m.model}`, provider: m.provider, model: m.model, note: m.note || '', status,
      errors_by_reason: errorsByReason(m.rows), ...(m.failed ? { failed_reason: m.failed } : {}),
      items: m.rows.length, expected: m.expected || m.rows.length, ...agg,
      failures: m.rows.filter(r => !r.pass).map(r => ({ id: r.id, set: r.set, detail: r.error || r.detail })) };
  });
  const ranked = rank(out.filter(m => m.status === 'done')).concat(out.filter(m => m.status !== 'done'));
  // An incomplete or stopped model is compared with every finished model on exactly the items it answered.
  const byKey = Object.fromEntries(models.map(m => [`${m.provider}:${m.model}`, Object.fromEntries(m.rows.map(r => [
    r.id, r]))]));
  for (const m of out.filter(x => x.status !== 'done')) {
    const ids = Object.keys(byKey[m.key]);
    const acc = (key) => ids.reduce((a, id) => a + ((byKey[key][id] && !byKey[key][id].error && byKey[key][id].score)
      || 0), 0) / (ids.length || 1);
    m.same_items = { items: ids.length, accuracy: { [m.key]: Math.round(acc(m.key) * 1000) / 1000 } };
    for (const d of out.filter(x => x.status === 'done')) m.same_items.accuracy[d.key] = Math.round(acc(
      d.key) * 1000) / 1000;
  }
  return { run, suite, started, finished, settings, ranking: ranked.map(m => m.key), models: ranked };
}

// Error rows grouped by code and where they stalled, e.g. { "timeout/connect": 12, "rate_limited": 2 }.
function errorsByReason(rows) {
  const out = {};
  for (const r of rows.filter(x => x.error)) {
    const k = `${r.error_code || String(r.error).split(/[\s:]/)[0]}${r.error_phase ? `/${r.error_phase}` : ''}`;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}`);
const sec = (ms) => (ms === null || ms === undefined ? '–' : `${(ms / 1000).toFixed(1)}`);

function markdown(rep) {
  const sets = SET_ORDER.filter(s => rep.models.some(m => m.sets[s]));
  const lines = [
    `# Colon benchmark — ${rep.run}`, '',
    `Suite \`${rep.suite}\`, ${rep.models[0] ? rep.models[0].expected :
      0} items per model. Started ${rep.started}, finished ${rep.finished}.`,
    `Score = 100 × (0.60 accuracy + 0.15 language quality + 0.10 speed + 0.15 reliability); ` +
      'see docs/phases/phase-5-benchmark.md. Cost: $0 on every free tier.', '',
    `| # | Model | Score | Acc | Lang | ${sets.map(s => SET_LABEL[s] || s).join(
      ' | ')} | 1st token median s | p90 s | Errors |`,
    `|---|---|---|---|---|${sets.map(() => '---').join('|')}|---|---|---|`,
  ];
  rep.models.forEach((m, i) => {
    lines.push(`| ${m.status === 'done' ? i + 1 : '–'} | ${m.key}${m.status !== 'done' ? ` (${m.status})` : ''}${m.note
      ? ` ¹` : ''} | ${m.score} | ${pct(m.components.accuracy)} | ${pct(m.components.language)} | ${sets.map(s => pct(
      m.sets[s] && m.sets[s].accuracy)).join(' | ')} | ${sec(m.overall.first_token_ms.median)} | ${sec(
      m.overall.first_token_ms.p90)} | ${pct(m.overall.error_rate)}% |`);
  });
  if (rep.models.some(m => m.note)) lines.push('', ...rep.models.filter(m => m.note).map(m => `¹ ${m.key}: ${m.note}`));
  lines.push('', ('Per-set columns are accuracy in % (errors count as 0). Lang = language quality on the '
    + 'Pidgin/Yorùbá/Hausa/Igbo sets.'));
  const partial = rep.models.filter(m => m.same_items);
  if (partial.length) {
    lines.push('', '## Incomplete or stopped models on the same items', '',
      'Accuracy of each model on exactly the items the incomplete model answered (errors count as 0).', '');
    for (const m of partial) lines.push(`- **${m.key}** (${m.status}, ${m.same_items.items} items): ${Object.entries(
      m.same_items.accuracy).map(([k, a]) => `${k === m.key ? '**' : ''}${k} ${pct(a)}%${k === m.key
      ? '**' : ''}`).join(' · ')}`);
  }
  lines.push('', '## Failures', '');
  for (const m of rep.models) {
    lines.push(`### ${m.key} — ${m.failures.length} of ${m.items} not fully correct`, '');
    if (m.failed_reason) lines.push(`Stopped: ${m.failed_reason}`, '');
    const why = Object.entries(m.errors_by_reason || {});
    if (why.length) lines.push(`Errors by reason: ${why.map(([k, n]) => `${k} ×${n}`).join(', ')}`, '');
    for (const f of m.failures) lines.push(`- \`${f.id}\`: ${String(f.detail).replace(/\s+/g, ' ').slice(0, 160)}`);
    lines.push('');
  }
  return lines.join('\n');
}

// One eval_runs row per model ("kind" bench). created_at = when the run finished, so the gate's age check is honest.
function evalRows(rep) {
  const when = new Date(rep.finished || Date.now());
  return rep.models.map(m => ({
    name: `Colon benchmark ${rep.run}`.slice(0, 120), model: m.model.slice(0, 128), provider: m.provider.slice(0, 32),
      kind: 'bench', suite: String(rep.suite || '').slice(0, 32),
    status: m.status === 'done' ? 'done' : 'failed', score: m.score, items: m.items, error_rate: m.overall.error_rate,
      first_token_ms: m.overall.first_token_ms.median,
    notes: `${m.status}; accuracy ${pct(m.components.accuracy)}%, language ${pct(
      m.components.language)}%, median first token ${sec(m.overall.first_token_ms.median)} s, errors ${pct(
      m.overall.error_rate)}%`.slice(0, 1000),
    details: { components: m.components, sets: Object.fromEntries(Object.entries(m.sets).map(([k, s]) => [k, { n: s.n,
      accuracy: s.accuracy, language: s.language, error_rate: s.error_rate, first_token_ms: s.first_token_ms }])) },
    created_at: when,
  }));
}

async function saveRuns(db, rep, userId = null) {
  const ids = [];
  for (const r of evalRows(rep)) {
    const res = await db.query(
      ('INSERT INTO eval_runs (name, model, provider, kind, suite, status, score, items, error_rate, '
        + 'first_token_ms, notes, details, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
      [r.name, r.model, r.provider, r.kind, r.suite, r.status, r.score, r.items, r.error_rate, r.first_token_ms,
        r.notes, JSON.stringify(r.details), userId, r.created_at]);
    ids.push(res.insertId);
  }
  return ids;
}

module.exports = { buildReport, markdown, evalRows, saveRuns, SET_ORDER };
