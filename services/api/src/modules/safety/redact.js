// Masks the user's own secrets before a message goes to an AI provider (the saved chat keeps what they typed,
// it is their own history): payment card numbers (Luhn-valid, 13–19 digits), BVN/NIN (11 digits next to the word),
// OTPs, PINs, CVVs and passwords written as "my PIN is 1234". Returns { text, count }.
const MASK = '[redacted]';

function luhn(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const KEYED = [
  /\b((?:bvn|nin)(?: number)?(?: is| na|:|=)? ?)\d{11}\b/gi,
  /\b((?:otp|one[- ]time (?:password|code)|token|verification code)(?: is| na|:|=) ?)\d{4,8}\b/gi,
  /\b((?:atm |card |transfer |bank )?pin(?: is| na|:|=) ?)\d{4,6}\b/gi,
  /\b((?:cvv|cvc)(?: is| na|:|=)? ?)\d{3,4}\b/gi,
  /\b((?:password|passcode|pass word)(?: is| na|:|=) ?)\S{4,}/gi,
];

function redact(text) {
  let count = 0;
  let s = String(text == null ? '' : text);
  s = s.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    count++;
    return MASK;
  });
  for (const re of KEYED) {
    s = s.replace(re, (m, head) => { count++; return head + MASK; });
  }
  return { text: s, count };
}

// Masks secrets in the user turns of an OpenAI-style message list (string or [{type:'text'}] content).
// -> { messages, count } (new objects; the input is not changed)
function redactMessages(messages) {
  let count = 0;
  const out = (messages || []).map((m) => {
    if (!m || m.role !== 'user') return m;
    if (typeof m.content === 'string') {
      const r = redact(m.content);
      count += r.count;
      return r.count ? { ...m, content: r.text } : m;
    }
    if (Array.isArray(m.content)) {
      let changed = false;
      const parts = m.content.map((p) => {
        if (!p || p.type !== 'text') return p;
        const r = redact(p.text);
        count += r.count;
        if (r.count) changed = true;
        return r.count ? { ...p, text: r.text } : p;
      });
      return changed ? { ...m, content: parts } : m;
    }
    return m;
  });
  return { messages: out, count };
}

module.exports = { redact, redactMessages, luhn, MASK };
