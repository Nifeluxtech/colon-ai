// Fits a request into a small prompt budget (0.11.0) for support models on low-TPM hosts (Groq: 8K tokens a minute).
// Saga's prompts are big: the system rules plus page snapshots ("Text: … Elements: …"). In order, until it fits:
//   1. older turns shrink to their first line (the newest two are kept whole);
//   2. page text inside snapshots is cut (newest snapshot last), keeping the element list Saga clicks by;
//   3. the oldest turns after the task go;
//   4. whatever is longest is cut in the middle (the system prompt last, never below a third of the budget).
// Pure: returns new message objects, never changes the caller's.
const len = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((n, p) => n + (p && p.type
  === 'text' ? String(p.text || '').length : 0), 0) : 0);
const total = (ms) => ms.reduce((n, m) => n + len(m.content), 0);
const TEXT = /\nText:\n([\s\S]*?)\nElements:/;

function cut(s, keep) {
  const str = String(s);
  if (str.length <= keep) return str;
  const head = Math.max(0, Math.floor(keep * 0.7)), tail = Math.max(0, keep - head - 20);
  return `${str.slice(0, head)} … [shortened] … ${tail ? str.slice(-tail) : ''}`;
}

function shrinkText(content, over) {
  const m = TEXT.exec(content);
  if (!m) return content;
  const keep = Math.max(200, m[1].length - over);
  return content.replace(m[1], () => cut(m[1], keep));
}

/** fit(messages, maxChars) -> messages whose text is at most about maxChars (0 / no budget: unchanged). */
function fit(messages, maxChars) {
  if (!(maxChars > 0) || total(messages) <= maxChars) return messages;
  let ms = messages.map((m) => ({ ...m }));
  const sys = ms[0] && ms[0].role === 'system' ? 1 : 0;
  // 1. Older turns to one line.
  for (let i = sys + 1; i < ms.length - 2 && total(ms) > maxChars; i++) {
    if (typeof ms[i].content === 'string' && ms[i].content.length > 160) {
      ms[i].content = `${ms[i].content.split('\n')[0].slice(0, 150)} (shortened)`;
    }
  }
  // 2. Page text in snapshots, oldest first.
  for (let i = sys; i < ms.length && total(ms) > maxChars; i++) {
    if (typeof ms[i].content === 'string') ms[i].content = shrinkText(ms[i].content, total(ms) - maxChars);
  }
  // 3. Oldest turns after the task (the first user message) go, keeping the newest two.
  while (total(ms) > maxChars && ms.length - sys > 3) ms.splice(sys + 1, 1);
  // 4. Longest first, the system prompt kept to at least a third of the budget.
  for (let guard = 0; total(ms) > maxChars && guard < 12; guard++) {
    let at = -1, best = 0;
    ms.forEach((m, i) => {
      if (typeof m.content !== 'string') return;
      const room = i === 0 && sys ? m.content.length - Math.floor(maxChars / 3) : m.content.length - 200;
      if (room > best) { best = room; at = i; }
    });
    if (at < 0) break;
    const c = ms[at].content;
    ms[at].content = cut(c, Math.max(at === 0 && sys ? Math.floor(maxChars / 3) : 200, c.length - (total(ms)
      - maxChars) - 40));
  }
  return ms;
}

module.exports = { fit, total };
