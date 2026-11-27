// Crash Predictor 0.39.3: an AI model's short read of the guess (guess.ai_reasoning). Display only.
//   aiReader({ generate, clock, enabled, timeoutMs, waitMs, perHour }) -> { annotate(userId, lastId, guess, verdict) }
// The model sees only numbers Colon already computed (last 10 rounds, mean, median, the calibrated range, the big
// range, the newest round's transition row, the 2x / 5x / 10x shares beside 0.97 / m, the verdict) and writes 2-3
// plain sentences with its read and a guess range. At most one call per user per new round (cached by the newest
// round id; one in flight at a time), a per-user hourly cap, an 8 s timeout; while it runs, on any error, with no
// provider, when CRASH_AI_REASONING=off or when the text breaks the rules below, the template reasoning is shown.
// It runs after the verdict is made and only writes guess.ai_reasoning: BET / WAIT / STOP and auto-bet never read it.
const TIMEOUT_MS = 8000;
const WAIT_MS = 1500;           // how long a request waits for a fresh read before showing the template
const PER_HOUR = 60;            // AI calls per user per hour
const MAX_USERS = 500;
const MAX_CHARS = 600;
const AI_LABEL = 'AI read · guess, not a prediction';
const TEMPLATE_LABEL = 'How the guess was made · guess, not a prediction';
const BANNED = new RegExp('\\b(guarantee[ds]?|certain(ly)?|sure (win|thing)|definitely|will (crash|reach|hit)|'
  + 'you should bet|bet now|place (a|your) bet|go all in)\\b', 'i');

const SYSTEM = [
  'You write a short read of JetX crash-game statistics for Colon\'s Live panel.',
  'JetX rounds are random and provably fair: each round is independent and past rounds do not change the next one.',
  'Never claim certainty or say a round will reach or crash at any value. Never tell the user to bet, to stake, or '
    + 'to change their bets, and never comment on the BET / WAIT / STOP verdict beyond restating it.',
  'Use only the numbers given. Give 2 or 3 short plain-English sentences: your read of the recent rounds and one '
    + 'guess range for the next round written like "1.40–2.30x". Keep that range consistent with the calibrated '
    + 'range given (inside or overlapping it). Call it a guess. No lists, no markdown, no emojis.',
].join('\n');

const x2 = (x) => `${Number(x).toFixed(2)}x`;
const pc = (r) => (r == null ? 'n/a' : `${Math.round(r * 100)}%`);

// The facts block the model gets (numbers only, no user data).
function facts(g, verdict, last10) {
  const t = g.transitions;
  const row = t && t.current != null ? t.buckets.map((b, j) => `${b.label}: ${pc(t.row_pct[t.current][j])}`)
    .join(', ') : 'n/a';
  const reach = (g.reach || []).filter((r) => r.at >= 2)
    .map((r) => `${r.at}x ${pc(r.share)} (published odds ${pc(r.baseline)})`).join('; ');
  return [
    `Last ${last10.length} rounds, oldest to newest: ${last10.map(x2).join(', ')}.`,
    `Last ${g.rounds_used} rounds: mean ${x2(g.mean)}, median ${x2(g.median)}.`,
    `Calibrated guess range: ${x2(g.range.low)}–${x2(g.range.high)} (tuned to hold about 70% of next rounds; held `
      + `${pc(g.coverage_measured)} of the last ${g.samples} on replay).`,
    `Big-round range: ${x2(g.big.low)}–${x2(g.big.high)}, ${g.big_chance} of recent rounds.`,
    t && t.current != null ? `After rounds in the newest round's bucket (${t.buckets[t.current].label}x), the next `
      + `round fell in: ${row} (${t.row_totals[t.current]} samples).` : 'Transition row: n/a.',
    `Share of recent rounds reaching: ${reach}.`,
    `Colon's verdict for the next round: ${verdict && verdict.action ? verdict.action : 'WAIT'} (not yours to `
      + 'change).',
  ].join('\n');
}

// The model's text, cleaned, or null when it is empty, too long to be a short read, or breaks a rule.
function clean(text) {
  const s = String(text || '').replace(/[*_#`>]+/g, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > MAX_CHARS * 2 || BANNED.test(s)) return null;
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1).replace(/\s+\S*$/, '')}…` : s;
}

const template = (g) => ({ text: g.reasoning, source: 'template', label: TEMPLATE_LABEL });

function aiReader({ generate, clock = () => new Date(), enabled = () => true, timeoutMs = TIMEOUT_MS,
  waitMs = WAIT_MS, perHour = PER_HOUR } = {}) {
  const done = new Map();     // userId -> { key, value }
  const flight = new Map();   // userId -> { key, promise }
  const calls = new Map();    // userId -> [call times]

  function allowed(userId, now) {
    const list = (calls.get(userId) || []).filter((t) => t > now - 3600000);
    calls.set(userId, list);
    if (list.length >= perHour) return false;
    list.push(now);
    return true;
  }
  function remember(map, userId, v) {
    map.delete(userId);
    map.set(userId, v);
    if (map.size > MAX_USERS) map.delete(map.keys().next().value);
  }

  async function ask(g, verdict, last10) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await generate({ mode: 'general', language: 'en', fun: false, context: SYSTEM, signal: ctl.signal,
        category: 'general', timeouts: { maxTokens: 220, firstTokenTimeoutMs: timeoutMs },
        messages: [{ role: 'user', content: `${facts(g, verdict, last10)}\n\nWrite the read now.` }] });
      const text = clean(r && r.text);
      return text ? { text, source: 'ai', label: AI_LABEL, model: (r && r.model) || null } : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  // -> guess with ai_reasoning set (the AI read when ready, else the template). Never throws.
  async function annotate(userId, lastId, g, verdict, last10 = []) {
    if (!g) return g;
    const key = String(lastId);
    const cached = done.get(userId);
    if (cached && cached.key === key) return { ...g, ai_reasoning: cached.value || template(g) };
    if (!enabled() || typeof generate !== 'function') return { ...g, ai_reasoning: template(g) };
    let f = flight.get(userId);
    if (!f || f.key !== key) {
      if (f || !allowed(userId, clock().getTime())) return { ...g, ai_reasoning: template(g) };
      const promise = ask(g, verdict, last10).then((value) => {
        remember(done, userId, { key, value });
        if (flight.get(userId) === f) flight.delete(userId);
        return value;
      });
      f = { key, promise };
      flight.set(userId, f);
    }
    let timer;
    const value = await Promise.race([f.promise, new Promise((res) => { timer = setTimeout(() => res(undefined),
      waitMs); })]);
    clearTimeout(timer);
    if (value === undefined) return { ...g, ai_reasoning: { ...template(g), pending: true } };
    return { ...g, ai_reasoning: value || template(g) };
  }

  return { annotate };
}

module.exports = { aiReader, facts, clean, SYSTEM, AI_LABEL, TEMPLATE_LABEL, TIMEOUT_MS, PER_HOUR };
