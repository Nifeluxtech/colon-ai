/* Colon AI · Saga's pop-up finder (0.11.2). SagaTools.kt evaluates this object expression together with tools.js
   and hands it to tools.js as its fourth argument (`ovl`); like tools.js it is evaluated fresh for every command and
   keeps nothing on the page's window. Owner's report on 0.11.1: Google's "Before you continue to Google" cookie
   dialog sat over the results and Saga kept pointing at a result behind it: the page snapshot listed the page's
   elements in document order (the dialog's buttons came after the first 60) and nothing said they were covered.
   find(win, doc) -> null | { el, kind, frame, label }: the topmost pop-up on screen now. Candidates: an open
   <dialog>, role=dialog / alertdialog, aria-modal=true, a consent iframe (consent.google.com, OneTrust, Didomi…),
   and the fixed-position box under a few points of the screen (a cookie banner, an overlay); a candidate counts only
   when it is really on top (elementFromPoint at its centre lands in it) and holds something to tap. kind "modal"
   (aria-modal, a modal <dialog>, half the screen or more, or a full-screen backdrop beside it) blocks the whole page
   behind it; "banner" only what it covers. frame: the pop-up is another site's frame Saga can't read inside.
   inside(ov, el): el is in the pop-up. blocks(ov, el, win, doc) -> '' | the pop-up's label: a tap on el would land
   on the pop-up instead (behind a modal, or under a banner at el's centre).
   dismisses(d): the element descriptor is a pop-up's decline / close button ("Reject all", "Only necessary", "Close",
   "No thanks", ×): a click that only declines, so it needs no approval. Mirrors services/api/src/modules/saga/
   policy.js DISMISS (a "Reject all" outside a pop-up, say in a moderation queue, still asks).
   Tested in services/api/tests/security/saga-phone-overlay.test.js. */
(function () {
  'use strict';
  var MODAL_SEL = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]';
  var ACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link]';
  var CONSENT = /consent|cookie|\bcmp\b|gdpr|didomi|onetrust|quantcast|trustarc|usercentrics|cookiebot|sourcepoint/i;
  var DISMISS = new RegExp('^(?:(?:reject|decline|refuse|deny) all(?: cookies)?|reject (?:non-essential|optional|'
    + 'additional) cookies|(?:accept |allow |use )?(?:only )?(?:necessary|essential|required)(?: cookies)?(?: only)?|'
    + 'close|dismiss|no,? thanks|not now|maybe later|[×✕✖x])$', 'i');
  var POINTS = [[0.5, 0.5], [0.5, 0.25], [0.5, 0.75], [0.5, 0.92], [0.5, 0.08]];

  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n
    ? s.slice(0, n) : s; }
  function view(win) { return { w: win.innerWidth || 1, h: win.innerHeight || 1 }; }
  function style(win, el) { try { return win.getComputedStyle(el) || {}; } catch (e) { return {}; } }
  function shown(win, el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect(), cs = style(win, el);
    return r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  }
  // The share of the screen el covers (0..1).
  function cover(win, el) {
    var r = el.getBoundingClientRect(), v = view(win);
    var w = Math.max(0, Math.min(r.left + r.width, v.w) - Math.max(r.left, 0));
    var h = Math.max(0, Math.min(r.top + r.height, v.h) - Math.max(r.top, 0));
    return (w * h) / (v.w * v.h);
  }
  function holds(a, b) { return !!a && !!b && (a === b || (typeof a.contains === 'function' && a.contains(b))); }
  function isRoot(doc, el) { return !el || el === doc.body || el === doc.documentElement; }
  function fixedOf(win, doc, el) {
    for (var i = 0; el && i < 25 && !isRoot(doc, el); i++, el = el.parentElement) {
      var p = style(win, el).position;
      if (p === 'fixed' || p === 'sticky') return el;
    }
    return null;
  }
  function count(el, sel) { return el && el.querySelectorAll ? el.querySelectorAll(sel).length : 0; }
  function isFrame(el) { return String(el.tagName || '').toLowerCase() === 'iframe'; }
  function frameName(el) {
    return [el.getAttribute('src'), el.getAttribute('id'), el.getAttribute('title'), el.getAttribute('name')]
      .join(' ');
  }
  function onTop(win, doc, el) {
    if (!doc.elementFromPoint) return false;
    var r = el.getBoundingClientRect(), v = view(win);
    var x = Math.max(1, Math.min(v.w - 1, r.left + r.width / 2)), y = Math.max(1, Math.min(v.h - 1,
      r.top + r.height / 2));
    return holds(el, doc.elementFromPoint(x, y));
  }
  function labelOf(doc, el) {
    var l = el.getAttribute('aria-label') || '';
    var by = el.getAttribute('aria-labelledby');
    if (!l && by && doc.getElementById) { var t = doc.getElementById(String(by).split(/\s+/)[0]);
      if (t) l = t.textContent; }
    if (!l && el.querySelector) { var h = el.querySelector('h1,h2,h3,[role=heading]'); if (h) l = h.textContent; }
    if (!l && isFrame(el)) l = el.getAttribute('title') || el.getAttribute('src') || 'a frame';
    return clip(l || el.innerText || el.textContent || 'a pop-up', 80);
  }
  function candidates(win, doc) {
    var out = [], v = view(win);
    Array.prototype.forEach.call(doc.querySelectorAll(MODAL_SEL), function (el) {
      if (shown(win, el)) out.push({ el: el, modal: el.getAttribute('aria-modal') === 'true'
        || String(el.getAttribute('role')).toLowerCase() === 'alertdialog' || modalDialog(el) });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('iframe'), function (el) {
      if (shown(win, el) && CONSENT.test(frameName(el)) && cover(win, el) >= 0.15) out.push({ el: el, modal: false });
    });
    if (doc.elementFromPoint) POINTS.forEach(function (p) {
      var f = fixedOf(win, doc, doc.elementFromPoint(p[0] * v.w, p[1] * v.h));
      if (f && cover(win, f) >= 0.12 && (isFrame(f) || count(f, ACTIVE) > 0)) out.push({ el: f, modal: false });
    });
    return out;
  }
  function modalDialog(el) {
    if (String(el.tagName || '').toLowerCase() !== 'dialog' || typeof el.matches !== 'function') return false;
    try { return el.matches(':modal'); } catch (e) { return false; }
  }
  // A full-screen backdrop beside the pop-up (the dimmed page): nothing to tap in it but the pop-up's own buttons.
  function backdrop(win, doc, el) {
    if (!doc.elementFromPoint) return false;
    var v = view(win), hits = [[0.03, 0.5], [0.97, 0.5]];
    return hits.some(function (p) {
      var f = fixedOf(win, doc, doc.elementFromPoint(p[0] * v.w, p[1] * v.h));
      return !!f && !holds(el, f) && cover(win, f) >= 0.9 && count(f, ACTIVE) <= count(holds(f, el) ? el : null,
        ACTIVE);
    });
  }

  // A full-screen fixed box holding most of the page's buttons and links is the site's own shell (many web apps lay
  // their whole page out that way), not a pop-up.
  function shell(win, doc, c) {
    if (c.modal || isFrame(c.el) || cover(win, c.el) < 0.9) return false;
    var all = count(doc.body, ACTIVE);
    return all > 0 && count(c.el, ACTIVE) >= 0.8 * all;
  }

  function find(win, doc) {
    var list = candidates(win, doc).filter(function (c) {
      return !isRoot(doc, c.el) && !shell(win, doc, c) && onTop(win, doc, c.el);
    });
    if (!list.length) return null;
    // The innermost of nested candidates (the dialog box, not the page shell around it).
    // Unrelated ones: a modal one first, then the one covering more of the screen.
    var best = list[0];
    list.forEach(function (c) {
      if (c === best) return;
      if (holds(best.el, c.el)) { best = { el: c.el, modal: c.modal || best.modal }; return; }
      if (holds(c.el, best.el)) { best.modal = best.modal || c.modal; return; }
      if ((c.modal && !best.modal) || (c.modal === best.modal && cover(win, c.el) > cover(win, best.el))) best = c;
    });
    var frame = isFrame(best.el), big = cover(win, best.el);
    var modal = best.modal || big >= 0.5 || backdrop(win, doc, best.el);
    return { el: best.el, kind: modal ? 'modal' : 'banner', frame: frame, label: labelOf(doc, best.el) };
  }
  function inside(ov, el) { return !!ov && holds(ov.el, el); }
  function blocks(ov, el, win, doc) {
    if (!ov || !el || inside(ov, el)) return '';
    if (ov.kind === 'modal') return ov.label;
    if (!doc.elementFromPoint || !el.getBoundingClientRect) return '';
    var r = el.getBoundingClientRect(), v = view(win), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > v.w || y > v.h) return '';
    return holds(ov.el, doc.elementFromPoint(x, y)) ? ov.label : '';
  }

  function dismisses(d) {
    return !!d && d.in_popup === true && DISMISS.test(clip(d.label || d.text, 60)) && d.tag !== 'input';
  }

  return { find: find, inside: inside, blocks: blocks, dismisses: dismisses, DISMISS: DISMISS };
})()
