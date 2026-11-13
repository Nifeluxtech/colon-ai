// Which Saga actions need the user's approval, tapped on the phone (Phase 9). The server decides from the action
// and what the last getPageContent said about the element; the phone checks the real element again before it acts
// and asks whenever either side says so (apps/android: SagaTools / BrowserSaga). Nothing the model writes can
// switch this off: tools.js rebuilds the arguments, and approval() is always called by the loop, never skipped.
//
// approval(command, ctx) -> null | { kind, reason }
//   kind: payment · purchase · send_message · form_submission · personal_data (strongest first)
const KINDS = ['payment', 'purchase', 'send_message', 'form_submission', 'personal_data'];

const words = (list) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');
const WORDS = {
  payment: new RegExp(words(['pay', 'pay now', 'payment', 'checkout', 'check out', 'proceed to pay', 'transfer',
    'send money', 'top ?up', 'recharge', 'fund (?:my )?wallet', 'withdraw', 'card details', 'sanwo', 'biya'])
    .source + '|₦\\s?\\d', 'i'),
  purchase: words(['buy', 'buy now', 'purchase', 'place (?:an |my )?order', 'order now', 'complete (?:the )?order',
    'book now', 'reserve', 'subscribe', 'donate', 'add to (?:cart|bag)', 'rent now']),
  send_message: words(['send', 'post', 'publish', 'tweet', 'reply', 'comment', 'share', 'message', 'email',
    'invite', 'upload']),
  form_submission: words(['submit', 'sign ?up', 'register', 'log ?in', 'sign ?in', 'apply', 'continue', 'next',
    'confirm', 'save', 'delete', 'remove', 'unsubscribe', 'verify']),
};

// Personal data in what Saga would type or put in a URL: email, Nigerian or international phone numbers, card
// numbers (Luhn), 11-digit BVN / NIN, and anything typed into a password, card, phone, email or address field.
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const PHONE = /(?:\+?234|\b0)[789][01]\d{8}\b|\+\d{10,14}\b/;
const ELEVEN = /\b\d{11}\b/;
const SENSITIVE_FIELD = new RegExp(String.raw`\b(?:password|passcode|pin|otp|cvv|cvc|card|cc-\w+|bvn|nin|ssn|`
  + String.raw`account ?number|iban|phone|tel|mobile|email|e-mail|address|street|postal|zip|birth|dob|passport|`
  + String.raw`licen[cs]e)\b`, 'i');

// A big text box for a message, reply, comment or post (a search box that happens to be a textarea is not one).
const MESSAGE_FIELD = /\b(?:message|reply|comment|post|tweet|chat|write|review|compose|caption)/i;

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function hasCard(s) {
  for (const m of String(s).matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return true;
  }
  return false;
}

/** personalData(text) -> the kind of personal data in it ('email' | 'phone' | 'card' | 'id_number') or null. */
function personalData(text) {
  const s = String(text || '');
  if (hasCard(s)) return 'card';
  if (EMAIL.test(s)) return 'email';
  if (PHONE.test(s)) return 'phone';
  if (ELEVEN.test(s)) return 'id_number';
  return null;
}

const describe = (el) => [el.label, el.text, el.name, el.placeholder, el.autocomplete, el.type, el.href]
  .filter(Boolean).join(' ').slice(0, 300);
const short = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n
  ? `${t.slice(0, n - 1)}…` : t; };

function forClick(el) {
  const words = describe(el);
  const named = el.label || el.text || el.name || el.type || el.tag || 'element';
  // A plain link only navigates; buttons (and links scripted as buttons) can act.
  const acts = !(el.tag === 'a' && el.href && el.role !== 'button');
  for (const kind of ['payment', 'purchase', 'send_message']) {
    if ((acts || kind !== 'send_message') && WORDS[kind].test(words)) {
      return { kind, reason: `Click "${short(named)}"` };
    }
  }
  const submits = el.type === 'submit' || (el.tag === 'button' && el.form && el.type !== 'button'
    && el.type !== 'reset') || (el.tag === 'input' && el.type === 'image' && el.form);
  if (submits || (WORDS.form_submission.test(words) && acts && (el.form || el.tag === 'button'
    || el.role === 'button'))) {
    return { kind: 'form_submission', reason: `Submit a form ("${short(named)}")` };
  }
  return null;
}

function forFill(args, el) {
  const field = el ? describe(el) : '';
  const named = el ? (el.label || el.name || el.placeholder || el.type || 'a field') : 'a field';
  if (args.submit) {
    const k = WORDS.payment.test(field) ? 'payment' : WORDS.send_message.test(field) ? 'send_message'
      : 'form_submission';
    return { kind: k, reason: `Type into "${short(named)}" and submit` };
  }
  if (el && (el.type === 'password' || SENSITIVE_FIELD.test(field))) {
    return { kind: WORDS.payment.test(field) || /card|cvv|cvc|cc-/i.test(field) ? 'payment' : 'personal_data',
      reason: `Type personal details into "${short(named)}"` };
  }
  const pd = personalData(args.value);
  if (pd) return { kind: 'personal_data', reason: `Type your ${pd.replace('_', ' ')} into "${short(named)}"` };
  // Typing a message into a large text box is preparing to send it; Saga asks before typing it.
  if (el && (el.tag === 'textarea' || el.contenteditable) && MESSAGE_FIELD.test(field)) {
    return { kind: 'send_message', reason: `Write a message in "${short(named)}"` };
  }
  return null;
}

function forUrl(url) {
  let q = '';
  try { const u = new URL(url); q = decodeURIComponent(u.search + u.hash); } catch { return null; }
  const pd = personalData(q);
  return pd ? { kind: 'personal_data', reason: `Open a link that contains your ${pd.replace('_', ' ')}` } : null;
}

function approval(cmd, ctx = {}) {
  const el = ctx.elements && cmd.args && cmd.args.id ? ctx.elements.get(cmd.args.id) : null;
  if (cmd.name === 'click') return forClick(el || { tag: 'element' });
  if (cmd.name === 'fill') return forFill(cmd.args, el);
  if (cmd.name === 'open_url' || cmd.name === 'new_tab') return cmd.args.url ? forUrl(cmd.args.url) : null;
  return null;
}

// The stronger of two decisions (the server's and the phone's).
function stronger(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return KINDS.indexOf(a.kind) <= KINDS.indexOf(b.kind) ? a : b;
}

module.exports = { approval, personalData, stronger, KINDS, WORDS, luhn };
