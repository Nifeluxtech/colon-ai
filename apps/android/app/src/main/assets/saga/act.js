/* Colon AI · Saga's typing and scrolling (0.10.2). SagaTools.kt evaluates this object expression together with
   tools.js and hands it to tools.js as its third argument (`ext`), so these run only after tools.js has found the
   element and refused secret fields; like tools.js it is evaluated fresh for every command and keeps nothing on the
   page's window.
   fill(el, args, win, doc): types the way the page can see it. Focus, select what is in the field, then
   document.execCommand('insertText'): the browser's own editing path, which fires beforeinput / input with
   inputType "insertText" (what React, Vue, Angular and editors such as ProseMirror, Lexical, Quill or Draft listen
   to) and works in contenteditable. When the page did not take it, the native value setter (React watches it) or
   textContent, then an InputEvent. Then change. A <select> picks the option by value or visible text. Returns
   { typed, method }: typed says the text is really in the field now.
   scroll(args, win, doc) / info(win, doc): the page, or, when the page itself does not scroll (many web apps scroll
   a container), the scrollable element under the middle of the view. Returns { y, max, target, moved? }.
   type(el, args, win, doc) (0.10.4): one piece of Saga's typing, so the user watches the text appear in the field:
   args.first empties the field first; then args.text goes in through the same editing path. fill() runs after the
   last piece and makes the field exact (and fires change), so a page that dropped a piece still gets the right text.
   Tested in services/api/tests/unit/saga-phone-act.test.js. */
(function () {
  'use strict';
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function valueOf(el) { return el.isContentEditable ? (el.innerText || el.textContent || '') : el.value; }
  function fire(el, win, type, init) {
    var C = (type === 'input' || type === 'beforeinput') && typeof win.InputEvent === 'function' ? win.InputEvent
      : win.Event;
    try { return el.dispatchEvent(new C(type, init)); } catch (e) { return true; }
  }
  // Enter, as a keyboard sends it. false when the page cancelled the keydown (it handled Enter itself).
  function enter(el, win) {
    var o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    var go = true;
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      try { var ok = el.dispatchEvent(new win.KeyboardEvent(t, o)); if (t === 'keydown') go = ok !== false; }
      catch (e) { /* an old engine: skip it */ }
    });
    return go;
  }
  function setValue(el, win, v) {
    var C = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement : el.tagName === 'SELECT' ? win.HTMLSelectElement
      : win.HTMLInputElement;
    var d = C && C.prototype ? Object.getOwnPropertyDescriptor(C.prototype, 'value') : null;
    if (d && d.set) d.set.call(el, v); else el.value = v;
  }
  function selectAll(el, win, doc) {
    try {
      if (el.isContentEditable) {
        var sel = win.getSelection && win.getSelection(), r = doc.createRange && doc.createRange();
        if (sel && r) { r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r); }
      } else if (typeof el.select === 'function') el.select();
    } catch (e) { /* inputs without a selection (number, email on old engines) */ }
  }
  function edit(doc, v) {
    try { return !!(doc.execCommand && doc.execCommand(v ? 'insertText' : 'delete', false, v)); }
    catch (e) { return false; }
  }
  // The option whose value or text matches (case-insensitive), else the first whose text starts with it.
  function option(el, v) {
    var want = norm(v).toLowerCase(), list = el.options || [], i, part = null;
    for (i = 0; i < list.length; i++) {
      var o = list[i], t = norm(o.text || o.textContent).toLowerCase();
      if (String(o.value).toLowerCase() === want || t === want) return o;
      if (!part && want && t.indexOf(want) === 0) part = o;
    }
    return part;
  }

  function fill(el, args, win, doc) {
    var v = String(args.value == null ? '' : args.value), method = 'insert';
    try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch (e) { /* old */ }
    try { el.focus({ preventScroll: true }); } catch (e) { if (el.focus) el.focus(); }
    if (el.tagName === 'SELECT') {
      var o = option(el, v);
      if (!o) return { typed: false, method: 'select', error: 'no_option' };
      setValue(el, win, o.value);
      fire(el, win, 'input', { bubbles: true, composed: true });
      fire(el, win, 'change', { bubbles: true });
      return { typed: el.value === o.value, method: 'select' };
    }
    selectAll(el, win, doc);
    if (!edit(doc, v) || norm(valueOf(el)) !== norm(v)) {
      method = 'setter';
      if (el.isContentEditable) el.textContent = v; else setValue(el, win, v);
      fire(el, win, 'input', { bubbles: true, composed: true, inputType: 'insertText', data: v });
    }
    fire(el, win, 'change', { bubbles: true });
    var out = { typed: norm(valueOf(el)) === norm(v), method: method };
    if (args.submit) {
      var form = el.form || (el.closest && el.closest('form'));
      // A page that handles Enter itself cancels the keydown; only otherwise is the form submitted for it.
      if (enter(el, win) && form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
      out.submitted = true;
    }
    return out;
  }

  function type(el, args, win, doc) {
    if (el.tagName === 'SELECT') return { typed: false };
    var t = String(args.text == null ? '' : args.text);
    if (args.first) {
      try { el.focus({ preventScroll: true }); } catch (e) { if (el.focus) el.focus(); }
      selectAll(el, win, doc);
      if (norm(valueOf(el)) && !edit(doc, '')) {
        if (el.isContentEditable) el.textContent = ''; else setValue(el, win, '');
      }
    }
    if (t && !edit(doc, t)) {
      if (el.isContentEditable) el.textContent = (el.textContent || '') + t;
      else setValue(el, win, String(el.value || '') + t);
      fire(el, win, 'input', { bubbles: true, composed: true, inputType: 'insertText', data: t });
    }
    return { typed: true };
  }

  function pageScrolls(win, doc) {
    var se = doc.scrollingElement || doc.documentElement;
    if (!se || se.scrollHeight - (win.innerHeight || 0) <= 2) return false;
    var cs = win.getComputedStyle ? win.getComputedStyle(doc.body || se) : null;
    return !cs || cs.overflowY !== 'hidden';
  }
  // The element that scrolls under the middle of the view, when the page itself does not.
  function scroller(win, doc) {
    if (pageScrolls(win, doc) || !doc.elementFromPoint) return null;
    var el = doc.elementFromPoint((win.innerWidth || 0) / 2, (win.innerHeight || 0) / 2);
    for (; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
      var oy = win.getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight - el.clientHeight > 2) return el;
    }
    return null;
  }
  function info(win, doc) {
    var el = scroller(win, doc), se = doc.scrollingElement || doc.documentElement;
    if (el) return { y: Math.round(el.scrollTop), max: Math.max(0, el.scrollHeight - el.clientHeight),
      target: 'element' };
    return { y: Math.round(win.scrollY || win.pageYOffset || 0), max: Math.max(0, (se ? se.scrollHeight : 0)
      - (win.innerHeight || 0)), target: 'page' };
  }
  function scroll(args, win, doc) {
    var el = scroller(win, doc), d = String(args.direction || 'down'), before = info(win, doc);
    var step = (el ? el.clientHeight : win.innerHeight || 0) * 0.8 * (d === 'up' ? -1 : 1);
    var to = d === 'top' ? 0 : d === 'bottom' ? before.max + 1 : before.y + step;
    // Instant even on pages with `scroll-behavior: smooth`, so the result says where it really is.
    var t = el || win;
    try { t.scrollTo({ top: to, left: el ? el.scrollLeft : win.scrollX || 0, behavior: 'instant' }); }
    catch (e) { if (el) el.scrollTop = to; else win.scrollTo(0, to); }
    var after = info(win, doc);
    after.moved = after.y !== before.y;
    return after;
  }

  return { fill: fill, type: type, scroll: scroll, info: info };
})()
