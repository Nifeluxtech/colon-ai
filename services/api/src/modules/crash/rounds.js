// Crash Predictor rounds (v0.35.0, step 3 of docs/crash-predictor/HANDOFF.md): cleaning what the collector, a CSV
// import or a manual entry sends, before anything is stored. Pure: no database, no clock of its own.
//   clean(row, { now, source })  -> { round } or { reason } (a round: { round_id, multiplier, observed_at, source })
//   parseCsv(text, { now })      -> { rows: [{ line, row, id }] } (id: the server's own stable id, or null);
//                                   throws 422 when empty, too big or over MAX_CSV_ROWS
//   duplicateOf(round, others)   -> true when a collector round with no round id repeats one seen within WINDOW_MS
// Multipliers are 1.00x to 1,000,000x with at most 2 decimals. A round with no round id gets a stable one from its
// time and multiplier (~t<ms>x<cents>), so the same round sent twice (a retry) is stored once.
const crypto = require('crypto');

const SOURCES = Object.freeze(['collector', 'csv', 'manual']);
const MAX_BATCH = 100;
const MAX_CSV_ROWS = 5000;
const MAX_CSV_CHARS = 400 * 1024;
const WINDOW_MS = 2000;
const MIN_TIME = Date.UTC(2015, 0, 1);
const FUTURE_MS = 5 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const NUM_RE = /^\d{1,7}(?:[.,]\d{1,2})?$/;

const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });

// 1.53, '1.53', '1,53', '1.53x', '1.53 ×' -> 1.53; anything else (more decimals, below 1, above 1e6) -> null.
function multiplierOf(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return null;
    return v >= 1 && v <= 1e6 ? Math.round(v * 100) / 100 : null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s*[x×]$/i, '');
  if (!NUM_RE.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return n >= 1 && n <= 1e6 ? Math.round(n * 100) / 100 : null;
}

// An ISO time, or epoch milliseconds (seconds when below 1e11). undefined/null/'' -> null; bad -> NaN.
function timeOf(v, now) {
  if (v === undefined || v === null || v === '') return null;
  let ms = NaN;
  if (typeof v === 'number' && Number.isFinite(v)) ms = v < 1e11 ? v * 1000 : v;
  else if (typeof v === 'string' && /^\d{9,13}$/.test(v.trim())) ms = timeOf(Number(v.trim()), now);
  else if (typeof v === 'string') ms = Date.parse(v.trim().replace(/^(\d{4}-\d\d-\d\d) (\d)/, '$1T$2'));
  if (!Number.isFinite(ms) || ms < MIN_TIME || ms > now.getTime() + FUTURE_MS) return NaN;
  return Math.round(ms);
}

const derivedId = (ms, m) => `~t${ms}x${Math.round(m * 100)}`;

// row: { round_id?, multiplier, ended_at? | seen_at? | time? }. source is the request's, not the row's; id is a
// stable id the server made itself (parseCsv), never one from the request.
function clean(row, { now = new Date(), source = 'collector', id: own = null } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { reason: 'not_a_round' };
  const multiplier = multiplierOf(row.multiplier);
  if (multiplier == null) return { reason: 'bad_multiplier' };
  const t = timeOf(row.ended_at ?? row.seen_at ?? row.time, now);
  if (Number.isNaN(t)) return { reason: 'bad_time' };
  let id = row.round_id == null || row.round_id === '' ? null : String(row.round_id).trim();
  if (id !== null && !ID_RE.test(id)) return { reason: 'bad_round_id' };
  const ms = t == null ? now.getTime() : t;
  const given = id !== null || Boolean(own);
  if (id === null) id = own || derivedId(ms, multiplier);
  return { round: { round_id: id, given, multiplier, observed_at: new Date(ms), source } };
}

// The same multiplier from the collector within WINDOW_MS of another round with no round id: the same round seen
// twice (two frames showing one history strip, a page that reloaded). JetX rounds are several seconds apart.
function duplicateOf(r, others) {
  if (r.source !== 'collector' || r.given) return false;
  const t = r.observed_at.getTime();
  return others.some((o) => o !== r && Number(o.multiplier) === r.multiplier && o.round_id !== r.round_id
    && Math.abs(new Date(o.observed_at).getTime() - t) <= WINDOW_MS);
}

const HEAD = { multiplier: /^(multiplier|crash|crash_?point|x|coef(ficient)?|odds|result|value)$/,
  time: /^(time|ended_?at|seen_?at|observed_?at|date|date_?time|timestamp|created_?at)$/,
  round_id: /^(round_?id|round|id|game_?id|round_?no|hash)$/ };

function splitLine(line, sep) {
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
}

// CSV text: columns multiplier[,time][,round_id], or any order under a header row naming them. Separator: tab,
// semicolon or comma (from the first line). Rows with no time share one stable id family from the file's own
// multipliers (~c<hash>:<n>), so importing the same file twice stores it once; they are stamped with the import
// time, first row oldest, 1 ms apart.
function parseCsv(text, { now = new Date() } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw err(422, 'invalid', 'Paste or choose a CSV file.', 'csv');
  if (text.length > MAX_CSV_CHARS) throw err(422, 'too_large', 'That file is too big (400 KB at most).', 'csv');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter((x) => x.l && !x.l.startsWith('#'));
  if (!lines.length) throw err(422, 'invalid', 'Paste or choose a CSV file.', 'csv');
  const first = lines[0].l;
  const sep = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  let cols = { multiplier: 0, time: 1, round_id: 2 };
  const headCells = splitLine(first, sep).map((c) => c.toLowerCase().replace(/[\s-]+/g, '_'));
  if (multiplierOf(headCells[0]) == null && headCells.some((c) => /[a-z]/.test(c))) {
    cols = {};
    headCells.forEach((c, i) => {
      for (const k of Object.keys(HEAD)) if (cols[k] === undefined && HEAD[k].test(c)) cols[k] = i;
    });
    if (cols.multiplier === undefined) throw err(422, 'invalid', 'The header needs a multiplier column.', 'csv');
    lines.shift();
  }
  if (lines.length > MAX_CSV_ROWS) {
    throw err(422, 'too_many_rows', `At most ${MAX_CSV_ROWS} rows per import.`, 'csv');
  }
  const cells = lines.map((x) => ({ n: x.n, c: splitLine(x.l, sep) }));
  const at = (c, k) => (cols[k] === undefined ? undefined : c[cols[k]]);
  const timeless = cells.filter((x) => !at(x.c, 'time') && !at(x.c, 'round_id'));
  const hash = crypto.createHash('sha1').update(timeless.map((x) => at(x.c, 'multiplier')).join('|'))
    .digest('hex').slice(0, 12);
  const rows = [];
  let k = 0;
  for (const x of cells) {
    const row = { multiplier: at(x.c, 'multiplier'), ended_at: at(x.c, 'time') || undefined,
      round_id: at(x.c, 'round_id') || undefined };
    let id = null;
    if (!row.ended_at && !row.round_id) {
      id = `~c${hash}:${k}`;
      row.ended_at = now.getTime() - (timeless.length - 1 - k);
      k += 1;
    }
    rows.push({ line: x.n, row, id });
  }
  return { rows, separator: sep, header: cols };
}

module.exports = { SOURCES, MAX_BATCH, MAX_CSV_ROWS, WINDOW_MS, multiplierOf, timeOf, clean, duplicateOf, parseCsv,
  derivedId };
