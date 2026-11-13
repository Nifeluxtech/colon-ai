// Secret forms Saga never fills (Phase 10). Passwords, one-time / 2FA codes, card numbers and CVV, PINs, sign-in
// pages (the app's Custom Tab sign-in list, UrlRules.kt) and payment pages are the user's to type. When Saga's next
// action targets one, it does not run: Saga hands the page to the user ("Enter your password here, then tap Return
// to AI"), waits, and resumes when control comes back. The phone checks the real element again (assets/saga/
// tools.js `inspect`, SecretFields.kt) and refuses with ack error `secret_field`; either side is enough.
// Values are never shown to the model: get_page_content is redacted here before the observation is built.
//
// fieldKind(el) -> 'password' | 'one_time_code' | 'card' | 'pin' | null
// pageKind(url) -> 'sign_in' | 'payment' | null
// check(cmd, { elements, url }) -> null | { kind, message, reason }
// redactContent(result) -> a copy with secret elements marked and their text, values and code-like digits hidden
const KINDS = ['password', 'one_time_code', 'card', 'pin', 'sign_in', 'payment'];

// Google and bank sign-in hosts: keep in step with UrlRules.CUSTOM_TAB_HOSTS (tests/security/saga-secrets.test.js).
const SIGN_IN_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'ibank.gtbank.com', 'ibank.accessbankplc.com',
  'ibank.zenithbank.com', 'ibank.ubagroup.com', 'ibank.firstbanknigeria.com'];
// Hosted payment pages (card, transfer and USSD checkouts used in Nigeria, plus the big international ones).
const PAYMENT_HOSTS = ['checkout.paystack.com', 'paystack.shop', 'checkout.flutterwave.com', 'ravemodal.flwv.io',
  'webpay.interswitchng.com', 'newwebpay.interswitchng.com', 'pay.remita.net', 'checkout.stripe.com',
  'www.paypal.com/checkoutnow', 'checkout.opaycheckout.com', 'pay.squadco.com', 'checkout.monnify.com'];

const SIGN_IN_PATH = new RegExp(String.raw`(?:^|\/)(?:log-?in|sign-?in|signin|sign_in|logon|auth(?:enticate)?|sso|`
  + String.raw`oauth2?\/authorize|2fa|mfa|otp|verify-otp)(?:\/|$|\.)`, 'i');
const PAYMENT_PATH = /(?:^|\/)(?:checkout|pay(?:ment)?s?)\/(?:card|details|pay|confirm)(?:\/|$)/i;

const AUTOCOMPLETE = {
  'current-password': 'password', 'new-password': 'password', 'one-time-code': 'one_time_code',
  'cc-number': 'card', 'cc-csc': 'card', 'cc-exp': 'card', 'cc-exp-month': 'card', 'cc-exp-year': 'card',
};
// Words in a field's name, id, label or placeholder (split on separators and camelCase: cardNumber -> card number).
const WORDS = [
  ['password', /\b(?:password|passwd|pwd|passphrase|secret)\b/],
  ['one_time_code', new RegExp(String.raw`\b(?:otp|totp|2fa|mfa|one ?time(?: pass(?:word|code))?|onetime|`
    + String.raw`verification code|verify code|auth(?:entication)? code|access code|token code|sms code)\b`)],
  ['card', new RegExp(String.raw`\b(?:cvv2?|cvc2?|csc|security code|card ?(?:number|no|num)|cardnumber|ccnum|`
    + String.raw`cc ?num|pan|expiry|exp(?:iry)? date|card)\b`)],
  ['pin', /\b(?:pin|passcode|transaction pin|atm pin)\b/],
];
const NOT_CARD = /\b(?:card ?holder|name on (?:the )?card|gift card|id card|card ?type)\b/;

const words = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-./[\]:]+/g, ' ').toLowerCase()
  .replace(/\s+/g, ' ').trim();

function fieldKind(el) {
  if (!el || typeof el !== 'object') return null;
  if (KINDS.includes(el.secret) && el.secret !== 'sign_in' && el.secret !== 'payment') return el.secret;
  const type = String(el.type || '').toLowerCase();
  if (type === 'password') return 'password';
  const tag = String(el.tag || '').toLowerCase();
  // Only things the user types into hold a secret (a "Forgot password?" link or a "Card" tab does not).
  if (tag && !['input', 'textarea', 'select'].includes(tag) && !el.contenteditable) return null;
  if (['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'hidden', 'file'].includes(type)) return null;
  for (const t of String(el.autocomplete || '').toLowerCase().split(/\s+/)) {
    if (AUTOCOMPLETE[t]) return AUTOCOMPLETE[t];
  }
  const w = words([el.name, el.id, el.label, el.placeholder].filter(Boolean).join(' '));
  for (const [kind, re] of WORDS) {
    if (!re.test(w)) continue;
    if (kind === 'card' && NOT_CARD.test(w)) continue;
    return kind;
  }
  // A short numeric "code" box (inputmode numeric or maxlength ≤ 8) is a one-time code.
  const max = Number(el.maxlength) || 0;
  const numeric = String(el.inputmode || '') === 'numeric';
  if (/\bcode\b/.test(w) && (numeric || (max > 0 && max <= 8))) return 'one_time_code';
  return null;
}

function hostMatches(host, rule) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const r = String(rule || '').toLowerCase();
  return r.startsWith('.') ? h === r.slice(1) || h.endsWith(r) : h === r;
}

function pageKind(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (SIGN_IN_HOSTS.some((r) => hostMatches(host, r))) return 'sign_in';
  const path = u.pathname.toLowerCase();
  if (PAYMENT_HOSTS.some((r) => { const [h, p] = r.split(/\/(.*)/); return hostMatches(host, h)
    && (!p || path.startsWith('/' + p)); })) return 'payment';
  if (PAYMENT_PATH.test(path)) return 'payment';
  if (SIGN_IN_PATH.test(path)) return 'sign_in';
  return null;
}

const MESSAGES = {
  password: 'Enter your password here, then tap Return to AI.',
  one_time_code: 'Enter the code you received here, then tap Return to AI.',
  card: 'Enter your card details here, then tap Return to AI.',
  pin: 'Enter your PIN here, then tap Return to AI.',
  sign_in: 'Sign in here yourself, then tap Return to AI.',
  payment: 'Enter the payment details here yourself, then tap Return to AI.',
};
const message = (kind) => MESSAGES[kind] || MESSAGES.password;

/** The secret a command would touch, or null. ctx.elements: the last getPageContent's Map id -> descriptor;
 *  ctx.url: the page Saga is on. */
function check(cmd, ctx = {}) {
  if (!cmd) return null;
  if (cmd.name === 'open_url' || cmd.name === 'new_tab') {
    const k = cmd.args && cmd.args.url ? pageKind(cmd.args.url) : null;
    // Opening a payment page to read it is fine; a sign-in host is the user's (and opens outside the panel).
    return k === 'sign_in' && SIGN_IN_HOSTS.some((r) => hostMatches(new URL(cmd.args.url).hostname, r))
      ? out(k, 'Open a sign-in page') : null;
  }
  if (cmd.name !== 'fill' && cmd.name !== 'click') return null;
  const el = ctx.elements && cmd.args && cmd.args.id ? ctx.elements.get(cmd.args.id) : null;
  const field = fieldKind(el);
  if (field) return out(field, `${cmd.name === 'fill' ? 'Type into' : 'Click'} "${name(el)}"`);
  if (cmd.name !== 'fill') return null;
  // Saga types nothing on a sign-in or payment page, nor into any field of a form that holds a secret.
  if (el && el.form_secret) return out(KINDS.includes(el.form_secret) ? el.form_secret : 'password',
    `Type into "${name(el)}" in a sign-in or payment form`);
  const page = pageKind(ctx.url);
  return page ? out(page, `Type into "${name(el)}" on a ${page === 'payment' ? 'payment' : 'sign-in'} page`) : null;
}
const name = (el) => String((el && (el.label || el.name || el.placeholder || el.type)) || 'a field').slice(0, 60);
const out = (kind, reason) => ({ kind, reason, message: message(kind) });

// Digits that look like a code someone was sent ("Your OTP is 482913"), and card numbers (Luhn).
const CODE_NEAR = /\b(otp|code|pin|token|passcode|password)\b([^\n\d]{0,24})(\d[\d -]{2,10}\d)\b/gi;
function luhn(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let x = Number(d[d.length - 1 - i]); if (i % 2) { x *= 2; if (x > 9) x -= 9; }
    sum += x; }
  return sum % 10 === 0;
}
function redactText(text) {
  return String(text == null ? '' : text)
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && luhn(d)
      ? '[card number hidden]' : m; })
    .replace(CODE_NEAR, (m, w, gap) => `${w}${gap}[hidden]`);
}

function redactContent(result) {
  if (!result || typeof result !== 'object') return result;
  const r = { ...result };
  if (Array.isArray(r.elements)) {
    r.elements = r.elements.map((e) => {
      if (!e || typeof e !== 'object') return e;
      const { value, ...rest } = e;             // a typed value never reaches the model, secret or not
      void value;
      const k = fieldKind(rest);
      return k ? { ...rest, secret: k, text: '', placeholder: rest.placeholder ? String(rest.placeholder)
        .replace(/\d/g, '•') : '' } : rest;
    });
  }
  if (r.text != null) r.text = redactText(r.text);
  if (r.title != null) r.title = redactText(r.title);
  return r;
}

module.exports = { fieldKind, pageKind, check, redactContent, redactText, message, KINDS, SIGN_IN_HOSTS,
  PAYMENT_HOSTS, MESSAGES };
