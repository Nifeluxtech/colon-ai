/* Colon AI · Saga's page tools (Phase 9). Injected by SagaTools.kt with WebView.evaluateJavascript into the tab
   Saga drives, as one function expression called with (command, args); it returns a JSON string. It is evaluated
   fresh for every command and keeps nothing on window, so a page can't swap these functions out.
   Commands: content · links · inspect (the element and its risk, before click/fill) · click · fill · scroll ·
   risk (pure, for tests). Element ids (c1, c2, …) are written to data-colon-saga by `content` and are only valid
   until the next `content`.
   Risk (approval on the phone): the phone's own check of the REAL element, independent of the server's. Kinds:
   payment · purchase · send_message · form_submission · personal_data. Mirrors services/api/src/modules/saga/
   policy.js; when either side says so, the user must tap Allow.
   Secret fields (Phase 10): passwords, one-time / 2FA codes, card numbers, CVV and expiry, PINs. `content` marks
   them (secret: kind) and every field of a form that holds one (form_secret), never with their text or value;
   `inspect` reports them, and `click` / `fill` refuse them (error secret_field): the user types these, never Saga.
   Mirrors services/api/src/modules/saga/secrets.js fieldKind (tests/security/saga-secrets.test.js). */
(function (cmd, args) {
  'use strict';
  var ATTR = 'data-colon-saga';
  var MAX_TEXT = 12000, MAX_ELEMENTS = 60, MAX_LINKS = 80;
  function any(list) { return new RegExp('\\b(?:' + list.join('|') + ')\\b', 'i'); }
  var W = {
    payment: new RegExp(any(['pay', 'pay now', 'payment', 'checkout', 'check out', 'proceed to pay', 'transfer',
      'send money', 'top ?up', 'recharge', 'fund (?:my )?wallet', 'withdraw', 'card details', 'sanwo', 'biya'])
      .source + '|₦\\s?\\d', 'i'),
    purchase: any(['buy', 'buy now', 'purchase', 'place (?:an |my )?order', 'order now', 'complete (?:the )?order',
      'book now', 'reserve', 'subscribe', 'donate', 'add to (?:cart|bag)', 'rent now']),
    send_message: any(['send', 'post', 'publish', 'tweet', 'reply', 'comment', 'share', 'message', 'email', 'invite',
      'upload']),
    form_submission: any(['submit', 'sign ?up', 'register', 'log ?in', 'sign ?in', 'apply', 'continue', 'next',
      'confirm', 'save', 'delete', 'remove', 'unsubscribe', 'verify'])
  };
  var SENSITIVE = any(['password', 'passcode', 'pin', 'otp', 'cvv', 'cvc', 'card', 'cc-\\w+', 'bvn', 'nin', 'ssn',
    'account ?number', 'iban', 'phone', 'tel', 'mobile', 'email', 'e-mail', 'address', 'street', 'postal', 'zip',
    'birth', 'dob', 'passport', 'licen[cs]e']);
  var MESSAGE_FIELD = /\b(?:message|reply|comment|post|tweet|chat|write|review|compose|caption)/i;

  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n
    ? s.slice(0, n) : s; }
  function luhn(d) { var sum = 0; for (var i = 0; i < d.length; i++) { var x = +d[d.length - 1 - i];
    if (i % 2) { x *= 2; if (x > 9) x -= 9; } sum += x; } return sum % 10 === 0; }
  function personal(v) {
    var s = String(v || ''), m, re = /\b(?:\d[ -]?){13,19}\b/g;
    while ((m = re.exec(s))) { var d = m[0].replace(/\D/g, ''); if (d.length >= 13 && d.length <= 19 && luhn(d))
      return 'card'; }
    if (/[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(s)) return 'email';
    if (/(?:\+?234|\b0)[789][01]\d{8}\b|\+\d{10,14}\b/.test(s)) return 'phone';
    if (/\b\d{11}\b/.test(s)) return 'id_number';
    return null;
  }
  function words(d) { return [d.label, d.text, d.name, d.placeholder, d.autocomplete, d.type, d.href].join(' '); }

  var AUTO = { 'current-password': 'password', 'new-password': 'password', 'one-time-code': 'one_time_code',
    'cc-number': 'card', 'cc-csc': 'card', 'cc-exp': 'card', 'cc-exp-month': 'card', 'cc-exp-year': 'card' };
  var SECRET_WORDS = [
    ['password', /\b(?:password|passwd|pwd|passphrase|secret)\b/],
    ['one_time_code', new RegExp('\\b(?:otp|totp|2fa|mfa|one ?time(?: pass(?:word|code))?|onetime|verification '
      + 'code|verify code|auth(?:entication)? code|access code|token code|sms code)\\b')],
    ['card', new RegExp('\\b(?:cvv2?|cvc2?|csc|security code|card ?(?:number|no|num)|cardnumber|ccnum|cc ?num|pan|'
      + 'expiry|exp(?:iry)? date|card)\\b')],
    ['pin', /\b(?:pin|passcode|transaction pin|atm pin)\b/]
  ];
  var NOT_CARD = /\b(?:card ?holder|name on (?:the )?card|gift card|id card|card ?type)\b/;
  var NOT_TYPED = /^(?:submit|button|reset|image|checkbox|radio|hidden|file)$/;
  function splitWords(s) { return String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-./[\]:]+/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim(); }
  /* secretKind(descriptor) -> 'password' | 'one_time_code' | 'card' | 'pin' | null */
  function secretKind(d) {
    var type = String(d.type || '').toLowerCase(), tag = String(d.tag || '').toLowerCase();
    if (type === 'password') return 'password';
    if (tag && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !d.contenteditable) return null;
    if (NOT_TYPED.test(type)) return null;
    var auto = String(d.autocomplete || '').toLowerCase().split(/\s+/);
    for (var i = 0; i < auto.length; i++) if (AUTO[auto[i]]) return AUTO[auto[i]];
    var w = splitWords([d.name, d.id, d.label, d.placeholder].filter(Boolean).join(' '));
    for (var j = 0; j < SECRET_WORDS.length; j++) {
      if (!SECRET_WORDS[j][1].test(w)) continue;
      if (SECRET_WORDS[j][0] === 'card' && NOT_CARD.test(w)) continue;
      return SECRET_WORDS[j][0];
    }
    var max = +d.maxlength || 0;
    if (/\bcode\b/.test(w) && (d.inputmode === 'numeric' || (max > 0 && max <= 8))) return 'one_time_code';
    return null;
  }

  /* risk(descriptor, { action: 'click'|'fill', value, submit }) -> { kind, reason } | null */
  function risk(d, a) {
    var w = words(d), named = clip(d.label || d.text || d.name || d.placeholder || d.type || d.tag, 60);
    if (a.action === 'fill') {
      if (a.submit) return { kind: W.payment.test(w) ? 'payment' : W.send_message.test(w) ? 'send_message'
        : 'form_submission', reason: 'Type into "' + named + '" and submit' };
      if (d.type === 'password' || SENSITIVE.test(w)) return { kind: /card|cvv|cvc|cc-/i.test(w) || W.payment.test(w)
        ? 'payment' : 'personal_data', reason: 'Type personal details into "' + named + '"' };
      var pd = personal(a.value);
      if (pd) return { kind: 'personal_data', reason: 'Type your ' + pd.replace('_', ' ') + ' into "' + named + '"' };
      if ((d.tag === 'textarea' || d.contenteditable) && MESSAGE_FIELD.test(w)) return {
        kind: 'send_message', reason: 'Write a message in "' + named + '"' };
      return null;
    }
    var acts = !(d.tag === 'a' && d.href && d.role !== 'button');
    var kinds = ['payment', 'purchase', 'send_message'];
    for (var i = 0; i < kinds.length; i++) {
      if ((acts || kinds[i] !== 'send_message') && W[kinds[i]].test(w)) return { kind: kinds[i],
        reason: 'Click "' + named + '"' };
    }
    var submits = d.type === 'submit' || (d.tag === 'button' && d.form && d.type !== 'button' && d.type !== 'reset')
      || (d.tag === 'input' && d.type === 'image' && d.form);
    if (submits || (W.form_submission.test(w) && acts && (d.form || d.tag === 'button' || d.role === 'button'))) {
      return { kind: 'form_submission', reason: 'Submit a form ("' + named + '")' };
    }
    return null;
  }
  if (cmd === 'risk') return JSON.stringify({ risk: risk(args.descriptor || {}, args) });
  if (cmd === 'secret') return JSON.stringify({ secret: secretKind(args.descriptor || {}) });

  var doc = document, win = window;
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = win.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  }
  function labelOf(el) {
    var l = el.getAttribute('aria-label') || '';
    if (!l && el.id) { var f = doc.querySelector('label[for="' + String(el.id).replace(/"/g, '') + '"]');
      if (f) l = f.textContent; }
    if (!l && el.closest) { var p = el.closest('label'); if (p) l = p.textContent; }
    return clip(l || el.getAttribute('title') || el.getAttribute('alt') || '', 80);
  }
  function describe(el) {
    var tag = el.tagName.toLowerCase();
    return { tag: tag, type: clip((el.getAttribute('type') || '').toLowerCase(), 20),
      role: clip((el.getAttribute('role') || '').toLowerCase(), 20), label: labelOf(el),
      // Typed values never leave the page; an input button's value is its label.
      text: clip(tag === 'textarea' || tag === 'select' ? '' : tag === 'input' ? (/^(submit|button|image|reset)$/i
        .test(el.type) ? el.value : '') : el.textContent, 80),
      name: clip(el.getAttribute('name'), 40), placeholder: clip(el.getAttribute('placeholder'), 60),
      autocomplete: clip(el.getAttribute('autocomplete'), 30), href: tag === 'a' ? clip(el.href, 300) : '',
      form: !!(el.form || (el.closest && el.closest('form'))), contenteditable: el.isContentEditable === true,
      inputmode: clip(el.getAttribute('inputmode'), 12), maxlength: +(el.getAttribute('maxlength') || 0) || 0,
      id: '' };
  }
  // The element's own id only feeds the secret check (it never leaves the page: the descriptor's id is Saga's).
  function secretOf(el) { var d = describe(el); d.id = clip(el.id, 40); return secretKind(d); }
  // The secret a form holds (its first secret field), so Saga types nothing into any of its fields.
  function formSecret(el) {
    var form = el.form || (el.closest && el.closest('form'));
    if (!form || !form.querySelectorAll) return null;
    var fields = form.querySelectorAll('input,textarea,select');
    for (var i = 0; i < fields.length; i++) { var k = secretOf(fields[i]); if (k) return k; }
    return null;
  }
  function mark(el, d) {
    var k = secretOf(el), f = formSecret(el);
    if (k) { d.secret = k; d.text = ''; d.placeholder = d.placeholder.replace(/\d/g, '•'); }
    if (f) d.form_secret = f;
    return d;
  }
  function find(id) {
    return /^c\d{1,4}$/.test(String(id)) ? doc.querySelector('[' + ATTR + '="' + id + '"]') : null;
  }
  function here() { return { url: String(win.location.href), title: clip(doc.title, 200) }; }

  if (cmd === 'content') {
    Array.prototype.forEach.call(doc.querySelectorAll('[' + ATTR + ']'), function (e) { e.removeAttribute(ATTR); });
    var sel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],'
      + '[contenteditable=true]';
    var out = [], n = 0;
    Array.prototype.some.call(doc.querySelectorAll(sel), function (el) {
      if (el.disabled || !visible(el)) return false;
      var id = 'c' + (++n);
      el.setAttribute(ATTR, id);
      var d = mark(el, describe(el)); d.id = id; out.push(d);
      return out.length >= MAX_ELEMENTS;
    });
    var body = doc.body ? doc.body.innerText || doc.body.textContent || '' : '';
    var h = here();
    return JSON.stringify({ url: h.url, title: h.title, text: clip(body, MAX_TEXT), elements: out,
      truncated: body.length > MAX_TEXT });
  }
  if (cmd === 'links') {
    var seen = {}, links = [];
    Array.prototype.some.call(doc.querySelectorAll('a[href]'), function (a) {
      var u = String(a.href); if (!/^https?:/i.test(u) || seen[u]) return false;
      seen[u] = 1;
      links.push({ text: clip(a.textContent || a.getAttribute('aria-label'), 80), url: u.slice(0, 2048) });
      return links.length >= MAX_LINKS;
    });
    return JSON.stringify({ links: links });
  }
  if (cmd === 'scroll') {
    var h2 = win.innerHeight * 0.8;
    if (args.direction === 'top') win.scrollTo(0, 0);
    else if (args.direction === 'bottom') win.scrollTo(0, doc.documentElement.scrollHeight);
    else win.scrollBy(0, args.direction === 'up' ? -h2 : h2);
    return JSON.stringify({ y: Math.round(win.scrollY), max: doc.documentElement.scrollHeight });
  }
  var el = find(args.id);
  if (!el) return JSON.stringify({ error: 'no_element' });
  var d = mark(el, describe(el));
  var secret = d.secret || (args.action === 'fill' || cmd === 'fill' ? d.form_secret : null) || null;
  if (cmd === 'inspect') return JSON.stringify({ descriptor: d, secret: secret, risk: risk(d, { action: args.action,
    value: args.value, submit: args.submit }) });
  // The last line of defence: whatever the server or the app decided, a secret field is never typed into or clicked.
  if (secret && (cmd === 'click' || cmd === 'fill')) return JSON.stringify({ error: 'secret_field', kind: secret });
  if (cmd === 'click') {
    el.scrollIntoView({ block: 'center' });
    el.click();
    return JSON.stringify(here());
  }
  if (cmd === 'fill') {
    el.scrollIntoView({ block: 'center' });
    el.focus();
    var v = String(args.value == null ? '' : args.value);
    if (el.isContentEditable) el.textContent = v;
    else {
      // React and similar frameworks watch the native value setter, not the property.
      var proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : el.tagName === 'SELECT'
        ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, v); else el.value = v;
    }
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    if (args.submit) {
      el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      var form = el.form || (el.closest && el.closest('form'));
      if (form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
    }
    return JSON.stringify(here());
  }
  return JSON.stringify({ error: 'unsupported' });
})
