/* Colon AI · Colon Secured Login fill (0.11.0, ADR 0007). Injected by SagaTools.run ONLY after the app checked, on
   the phone, that the page's host belongs to the saved login's site, that the user marked the site trusted and that
   they approved Saga signing in there. Called with { user, pass, submit } read from the Keystore-encrypted vault;
   the values go into the page's own fields and nowhere else: this script returns only what it did ({ filled,
   submitted, step }), never a value, and nothing stays on window. Two-step sign-ins (email first, password on the
   next page) fill what is there; the app calls again on the next page. */
(function (args) {
  'use strict';
  var doc = document;
  function shown(el) {
    if (!el || el.disabled || el.readOnly) return false;
    var r = el.getBoundingClientRect(), st = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  }
  function set(el, v) {
    el.focus();
    var proto = Object.getPrototypeOf(el), d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }
  var fields = Array.prototype.filter.call(doc.querySelectorAll('input'), shown);
  var pass = fields.filter(function (el) { return el.type === 'password'
    && !/new-password/.test(el.getAttribute('autocomplete') || ''); })[0];
  var USER = /user|email|e-mail|login|phone|account|identifier|name/i;
  var user = fields.filter(function (el) {
    var t = (el.type || 'text').toLowerCase();
    if (!/^(text|email|tel)$/.test(t)) return false;
    var a = (el.getAttribute('autocomplete') || '') + ' ' + el.name + ' ' + el.id + ' ' + (el.placeholder || '')
      + ' ' + (el.getAttribute('aria-label') || '');
    return /username|email/.test(el.getAttribute('autocomplete') || '') || USER.test(a);
  })[0];
  if (!user && pass) {
    var before = fields.filter(function (el) { return el !== pass && /^(text|email|tel)$/.test(el.type || 'text')
      && (pass.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING); });
    user = before[before.length - 1];
  }
  if (!user && !pass) return JSON.stringify({ error: 'no_form' });
  if (user && args.user) set(user, String(args.user));
  if (pass && args.pass) set(pass, String(args.pass));
  var submitted = false;
  if (args.submit) {
    var form = (pass || user).form;
    var btn = form && (form.querySelector('button[type=submit],input[type=submit]') || form.querySelector('button'));
    if (btn && shown(btn)) { btn.click(); submitted = true; }
    else if (form && form.requestSubmit) { form.requestSubmit(); submitted = true; }
  }
  return JSON.stringify({ filled: { user: !!(user && args.user), pass: !!(pass && args.pass) }, submitted: submitted,
    step: pass ? 'password' : 'identifier' });
})
