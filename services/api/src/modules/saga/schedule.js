// Scheduled browsing, the pure part (0.11.0, ADR 0007): reading "every morning" / "every Monday at 9" out of a
// request, the next run time in the user's local time, the items a run found and what is new since the last run,
// and the chat message that reports it. No database, no clock of its own: unit-tested in saga-schedule.test.js.
const CADENCES = ['hourly', 'daily', 'weekdays', 'weekly'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PARTS = { morning: 8 * 60, afternoon: 14 * 60, evening: 19 * 60, night: 21 * 60 };
const MIN = 60e3, DAY = 1440;

// "7am", "7:30 pm", "18:00", "at 9" -> minutes after midnight (null when there is no time).
function timeOf(text) {
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i
    .exec(text);
  if (!m) return null;
  let h = Number(m[1] || m[4] || m[7]);
  const min = Number(m[2] || m[5] || m[8] || 0), ap = (m[3] || m[6] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

const WHEN = new RegExp(String.raw`\b(?:every|each)\s+(?:single\s+)?(hour|day|morning|afternoon|evening|night|`
  + String.raw`weekday|week|${DAYS.join('|')})s?\b|\b(hourly|daily|nightly|weekly)\b`, 'i');
const TIME_PHRASE = /\s*\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/gi;

/**
 * parse(text) -> null | { cadence, at_minute, weekday, goal }: the schedule in a request ("check yolotask every
 * morning and tell me about new tasks" -> daily at 08:00, goal "check yolotask and tell me about new tasks").
 */
function parse(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const m = WHEN.exec(s);
  if (!m) return null;
  const w = (m[1] || m[2]).toLowerCase();
  const at = timeOf(s);
  let cadence = 'daily', weekday = null, minute = at == null ? PARTS.morning : at;
  if (w === 'hour' || w === 'hourly') { cadence = 'hourly'; minute = at == null ? 0 : at % 60; }
  else if (PARTS[w] != null) minute = at == null ? PARTS[w] : at;
  else if (w === 'nightly') minute = at == null ? PARTS.night : at;
  else if (w === 'weekday') cadence = 'weekdays';
  else if (w === 'week' || w === 'weekly') { cadence = 'weekly'; weekday = 1; }
  else if (DAYS.includes(w)) { cadence = 'weekly'; weekday = DAYS.indexOf(w); }
  const goal = s.replace(m[0], ' ').replace(TIME_PHRASE, ' ').replace(/\b(?:and\s+)?remind me\b/i, ' ')
    .replace(/\s+([,.;!?])/g, '$1').replace(/\s+/g, ' ').replace(/^(?:please\s+)?(?:can you\s+)?/i, '').trim();
  return { cadence, at_minute: minute, weekday, goal: goal || s };
}

/** The next run after `now` (a Date), in UTC, for a schedule in the user's time zone (tz_offset minutes east). */
function nextRun(s, now = new Date()) {
  const tz = Number(s.tz_offset) || 0;
  const at = Math.max(0, Math.min(DAY - 1, Number(s.at_minute) || 0));
  const local = new Date(now.getTime() + tz * MIN);           // the user's wall clock, read with UTC getters
  const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const toUtc = (t) => new Date(t - tz * MIN);
  if (s.cadence === 'hourly') {
    const h = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours(), at % 60);
    return toUtc(h > local.getTime() ? h : h + 60 * MIN);
  }
  for (let d = 0; d <= 8; d++) {
    const t = base + d * DAY * MIN + at * MIN;
    if (t <= local.getTime()) continue;
    const wd = new Date(t).getUTCDay();
    if (s.cadence === 'weekdays' && (wd === 0 || wd === 6)) continue;
    if (s.cadence === 'weekly' && wd !== (Number(s.weekday) || 0)) continue;
    return toUtc(t);
  }
  return toUtc(base + DAY * MIN + at * MIN);
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** "every day at 08:00", "every Monday at 09:00", "every hour at :15". */
function describe(s) {
  const at = Number(s.at_minute) || 0;
  if (s.cadence === 'hourly') return `every hour at :${String(at % 60).padStart(2, '0')}`;
  if (s.cadence === 'weekdays') return `every weekday at ${hhmm(at)}`;
  if (s.cadence === 'weekly') { const d = DAYS[Number(s.weekday) || 0];
    return `every ${d[0].toUpperCase()}${d.slice(1)} at ${hhmm(at)}`; }
  return `every day at ${hhmm(at)}`;
}

const MAX_ITEMS = 200;
const keyOf = (t) => String(t).toLowerCase().replace(/\[\d+\]/g, '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ')
  .trim().slice(0, 200);

/** The items a run found: an extracted table's rows, else the answer's list lines. [{ key, text }] */
function items(answer, tables) {
  const out = [];
  for (const t of tables || []) for (const row of t.rows || []) out.push(row.filter(Boolean).join(' | '));
  if (!out.length) {
    for (const line of String(answer || '').split('\n')) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
      if (m) out.push(m[1]);
    }
  }
  const seen = new Set();
  return out.map((t) => ({ key: keyOf(t), text: String(t).replace(/\s+/g, ' ').trim().slice(0, 300) }))
    .filter((x) => x.key && !seen.has(x.key) && seen.add(x.key)).slice(0, MAX_ITEMS);
}

/** What is new since the last run (prev: the stored items, or null on the first run). */
function diff(prev, cur) {
  if (!Array.isArray(prev)) return { first: true, fresh: cur };
  const old = new Set(prev.map((x) => (typeof x === 'string' ? x : x && x.key)));
  return { first: false, fresh: cur.filter((x) => !old.has(x.key)) };
}

/** The chat message for a finished scheduled run. o: { late: due Date or null, ranAt, fresh, first, status, error } */
function message(s, r, o) {
  const when = (d) => new Date(new Date(d).getTime() + (Number(s.tz_offset) || 0) * MIN).toISOString().slice(11, 16);
  const head = `**${s.name}** · scheduled check, ${describe(s)}`
    + (o.late ? ` _(ran late: it was due at ${when(o.late)}, but your phone was offline or Colon AI was closed; it `
      + `ran at ${when(o.ranAt)})_` : '');
  if (r.status !== 'done') {
    return `${head}\n\n_This run didn’t finish (${r.error || r.status}). I’ll try again at the next time._`
      + (r.answer ? `\n\n${r.answer}` : '');
  }
  let news = '';
  if (o.first) news = o.fresh.length ? `\n\n**First run:** ${o.fresh.length} item${o.fresh.length === 1 ? '' : 's'} `
    + 'found. Next time I’ll tell you what’s new.' : '';
  else if (o.fresh.length) {
    news = `\n\n**New since last run (${o.fresh.length})**\n${o.fresh.slice(0, 30).map((x) => `- ${x.text}`)
      .join('\n')}${o.fresh.length > 30 ? `\n- …and ${o.fresh.length - 30} more` : ''}`;
  } else news = '\n\n**Nothing new since last run.**';
  return `${head}\n\n${String(r.answer || '').trim()}${news}`;
}

module.exports = { parse, nextRun, describe, items, diff, message, timeOf, CADENCES, MAX_ITEMS, keyOf };
