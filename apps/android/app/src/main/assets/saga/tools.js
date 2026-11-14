/* Colon AI · Saga's page tools (Phase 9). Injected by SagaTools.kt with WebView.evaluateJavascript into the tab
   Saga drives, as one function expression called with (command, args, ext); it returns a JSON string. It is
   evaluated fresh for every command and keeps nothing on window, so a page can't swap these functions out. ext
   (0.10.2) is act.js, evaluated with it: typing (fill) and scrolling, run only after the checks here.
   Commands: content · links · inspect (the element and its risk, before click/fill) · point (where to tap) ·
   click (script fallback) · outcome (did the click change anything) · fill · scroll · scrollinfo · risk, secret,
   changed (pure). Element ids (c1, c2, …) are written to data-colon-saga by `content` and are only valid
   until the next `content`.
   Risk (approval on the phone): the phone's own check of the REAL element, independent of the server's. Kinds:
   payment · purchase · send_message · form_submission · personal_data. Mirrors services/api/src/modules/saga/
   policy.js; when either side says so, the user must tap Allow.
   Secret fields (Phase 10): passwords, one-time / 2FA codes, card numbers, CVV and expiry, PINs. `content` marks
   them (secret: kind) and every field of a form that holds one (form_secret), never with their text or value;
   `inspect` reports them, and `click` / `fill` refuse them (error secret_field): the user types these, never Saga.
   Mirrors services/api/src/modules/saga/secrets.js fieldKind (tests/security/saga-secrets.test.js). */
(function (cmd, args, ext) {
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
  // 0.10.2 (act.js): the page or the container that really scrolls; moved says whether anything did.
  if (cmd === 'scroll' || cmd === 'scrollinfo') {
    if (!ext) return JSON.stringify({ error: 'unsupported' });
    return JSON.stringify(cmd === 'scroll' ? ext.scroll(args, win, doc) : ext.info(win, doc));
  }
  /* 0.10.1: real clicks. `point` scrolls the element to the middle of the view and says where it is, as fractions
     of the visible viewport (Kotlin multiplies by the WebView's size, so zoom and density need no maths there), and
     what is under that point; SagaTools taps there with real touch events. `click` is the script fallback: the
     pointer / mouse sequence a finger makes, then focus and click. `outcome` compares the page with `before` (from
     point) so Saga hears whether its click did anything. */
  function viewport() {
    var vv = win.visualViewport;
    return vv && vv.width > 0 ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height }
      : { x: 0, y: 0, w: win.innerWidth || 1, h: win.innerHeight || 1 };
  }
  function frac(n) { return Math.round(n * 10000) / 10000; }
  function where(el) {
    var r = el.getBoundingClientRect(), v = viewport();
    var px = r.left + r.width / 2, py = r.top + r.height / 2, cx = (px - v.x) / v.w, cy = (py - v.y) / v.h;
    return { x: frac((r.left - v.x) / v.w), y: frac((r.top - v.y) / v.h), w: frac(r.width / v.w),
      h: frac(r.height / v.h), cx: frac(cx), cy: frac(cy), in_view: cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1,
      px: px, py: py };
  }
  function targetState(el) {
    if (!el) return 'gone';
    return [el.checked, el.open, el.getAttribute('aria-expanded'), el.getAttribute('aria-pressed'),
      el.getAttribute('aria-selected'), el.getAttribute('aria-checked')].join('|');
  }
  function sig(el) {
    var b = doc.body, t = b ? String(b.innerText || b.textContent || '') : '', h = 0, a = doc.activeElement;
    for (var i = 0; i < t.length && i < 200000; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return { url: String(win.location.href), title: clip(doc.title, 200), len: t.length, hash: h,
      nodes: doc.getElementsByTagName ? doc.getElementsByTagName('*').length : 0, el: targetState(el),
      focus: a && a !== b && a.getAttribute ? a.getAttribute(ATTR) || a.tagName : '' };
  }
  /* changed(before, after) -> navigated · url_changed (same page, new #hash or history state) · page_changed ·
     element_changed (checked, expanded, pressed, selected, open) · focused · none · unknown */
  function changed(b, a) {
    if (!b || typeof b !== 'object') return 'unknown';
    if (a.url !== b.url) return a.url.split('#')[0] === String(b.url).split('#')[0] ? 'url_changed' : 'navigated';
    if (a.title !== b.title || a.hash !== b.hash || a.len !== b.len || a.nodes !== b.nodes) return 'page_changed';
    if (a.el !== b.el) return 'element_changed';
    return a.focus !== b.focus ? 'focused' : 'none';
  }
  if (cmd === 'changed') return JSON.stringify({ changed: changed(args.before, args.after) });
  if (cmd === 'outcome') {
    var now = sig(find(args.id));
    return JSON.stringify({ url: now.url, title: now.title, changed: changed(args.before, now) });
  }
  function press(el, p) {
    var o = { bubbles: true, cancelable: true, composed: true, view: win, clientX: p.px, clientY: p.py, button: 0,
      pointerId: 1, pointerType: 'touch', isPrimary: true };
    function fire(C, type, buttons) {
      if (typeof C !== 'function') return;
      try { o.buttons = buttons; el.dispatchEvent(new C(type, o)); } catch (e) { /* an old engine: skip it */ }
    }
    fire(win.PointerEvent || win.MouseEvent, 'pointerdown', 1); fire(win.MouseEvent, 'mousedown', 1);
    if (el.focus) el.focus({ preventScroll: true });
    fire(win.PointerEvent || win.MouseEvent, 'pointerup', 0); fire(win.MouseEvent, 'mouseup', 0);
    el.click();
  }

  var el = find(args.id);
  if (!el) return JSON.stringify({ error: 'no_element' });
  var d = mark(el, describe(el));
  var secret = d.secret || (args.action === 'fill' || cmd === 'fill' || cmd === 'type' ? d.form_secret : null) || null;
  if (cmd === 'inspect') return JSON.stringify({ descriptor: d, secret: secret, risk: risk(d, { action: args.action,
    value: args.value, submit: args.submit }) });
  // The last line of defence: whatever the server or the app decided, a secret field is never typed into, clicked,
  // tapped (point comes right before every native tap) or pointed at.
  if (secret && /^(click|fill|point|type)$/.test(cmd)) return JSON.stringify({ error: 'secret_field', kind: secret });
  if (cmd === 'point' || cmd === 'click') {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    var p = where(el), hit = doc.elementFromPoint ? doc.elementFromPoint(p.px, p.py) : null;
    var lab = hit && hit.closest ? hit.closest('label') : null;
    var onIt = !hit || hit === el || (el.contains && el.contains(hit)) || (!!lab && lab.control === el);
    // What a tap at that point would really reach: never a secret field, even one laid over the element.
    var under = hit && hit !== el ? secretOf(hit) : null;
    if (under) return JSON.stringify({ error: 'secret_field', kind: under });
    if (cmd === 'click') {
      var before = sig(el);
      press(el, p);
      return JSON.stringify(Object.assign(here(), { method: 'script', before: before }));
    }
    return JSON.stringify({ x: p.x, y: p.y, w: p.w, h: p.h, cx: p.cx, cy: p.cy, in_view: p.in_view, hit: onIt,
      covered: onIt ? '' : clip(labelOf(hit) || hit.textContent, 60), before: sig(el) });
  }
  // 0.10.2 (act.js): typed through the browser's own editing path (input events a page registers), verified.
  if (cmd === 'fill') {
    if (!ext) return JSON.stringify({ error: 'unsupported' });
    var typed = ext.fill(el, args, win, doc);
    return JSON.stringify(typed.error ? typed : Object.assign(here(), typed));
  }
  // 0.10.4 (act.js): one piece of Saga's typing, shown as it goes; the fill after it makes the field exact.
  if (cmd === 'type') return JSON.stringify(ext && ext.type ? ext.type(el, args, win, doc) : { error: 'unsupported' });
  return JSON.stringify({ error: 'unsupported' });
})
