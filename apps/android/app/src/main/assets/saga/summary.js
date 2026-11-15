/* Colon AI · the page as the chat model sees it (0.11.5). SagaTools.kt wraps it with the vendored Mozilla
   Readability (Apache-2.0) and Turndown (MIT) in one function scope (nothing is left on window) and calls it with
   (Readability, TurndownService, args) on the page this chat's browser shows, when the user sends a message:
     summary  the page's main content as short Markdown (Readability picks the article; pages that are not one, like
              dashboards and search results, use the visible text of <main> or the body), at most ~1,500 characters
     items    the clickable things on screen, numbered in the order a person reads them (inside <main> first, then the
              rest; header, navigation and footer last), at most 25: { text, href, kind: link | button }
   Form fields, their values and hidden elements are never read; the server neutralises and fences all of it.
   -> JSON string { url, title, summary, items }. */
(function (Readability, TurndownService, args) {
  'use strict';
  var MAX = Math.max(200, Math.min(4000, Number(args && args.max) || 1500));
  var MAX_ITEMS = 25, doc = document;
  var CLICKABLE = 'a[href],button,[role=button],[role=link],input[type=submit],input[type=button],summary';
  var EDGE = 'header,nav,footer,[role=banner],[role=navigation],[role=contentinfo]';

  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n
    ? s.slice(0, n - 1) + '…' : s; }
  function cut(md) {
    md = String(md || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (md.length <= MAX) return md;
    var at = md.lastIndexOf(' ', MAX - 1);
    return md.slice(0, at > MAX * 0.8 ? at : MAX - 1).trim() + '…';
  }
  function shown(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect(), cs = window.getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  }
  function markdown(html) {
    try {
      var td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
      td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'input', 'select', 'textarea', 'button', 'svg',
        'img', 'video', 'audio', 'canvas']);
      td.addRule('textLinks', { filter: 'a', replacement: function (content) { return content; } });
      return td.turndown(html);
    } catch (e) { return ''; }
  }
  function plain() {
    var main = doc.querySelector('main,[role=main]') || doc.body;
    if (!main) return '';
    var t = String(main.innerText || main.textContent || '');
    return t.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
  }
  function summary() {
    var md = '';
    try {
      var a = new Readability(doc.cloneNode(true), { charThreshold: 300 }).parse();
      if (a && a.content && String(a.textContent || '').trim().length >= 300) {
        md = (a.title ? '# ' + clip(a.title, 160) + '\n\n' : '') + markdown(a.content);
      }
    } catch (e) { md = ''; }
    return cut(md || plain());
  }
  function label(el) {
    var t = el.getAttribute('aria-label') || '';
    if (!t) t = el.tagName === 'INPUT' ? el.value || '' : el.innerText || el.textContent || '';
    if (!t) t = el.getAttribute('title') || '';
    if (!t) { var img = el.querySelector && el.querySelector('img[alt]'); if (img) t = img.getAttribute('alt'); }
    return clip(t, 100);
  }
  function items() {
    var main = doc.querySelector('main,[role=main]');
    var seen = {}, first = [], rest = [], edge = [];
    Array.prototype.forEach.call(doc.querySelectorAll(CLICKABLE), function (el) {
      if (el.closest && el.closest('[hidden],[aria-hidden=true]')) return;
      if (el.type === 'password' || !shown(el)) return;
      var text = label(el);
      var href = el.tagName === 'A' ? String(el.href || '') : '';
      if (!text || /^javascript:/i.test(href)) return;
      var key = text.toLowerCase() + '|' + href;
      if (seen[key]) return;
      seen[key] = 1;
      var it = { text: text, href: /^https?:/i.test(href) ? href.slice(0, 600) : '', kind: href ? 'link' : 'button' };
      if (main && main.contains(el)) first.push(it);
      else if (el.closest && el.closest(EDGE)) edge.push(it);
      else rest.push(it);
    });
    return first.concat(rest, edge).slice(0, MAX_ITEMS);
  }
  var out = { url: String(location.href), title: clip(doc.title, 200), summary: '', items: [] };
  try { out.summary = summary(); } catch (e) { out.summary = ''; }
  try { out.items = items(); } catch (e) { out.items = []; }
  return JSON.stringify(out);
})
