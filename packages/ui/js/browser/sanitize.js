/* ColonBrowserData · the reader-preview sanitiser: fetched HTML becomes safe text and images (no scripts,
   forms or event handlers). */

import { MAX_PAGE } from './data-common.js';
import { ColonURL } from '../url.js';

var U = ColonURL;

/* ---------- Sanitiser: untrusted HTML -> safe reader HTML ---------- */
var ALLOWED = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, A: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1,
  CODE: 1, EM: 1, STRONG: 1, B: 1, I: 1, U: 1, S: 1, SMALL: 1,
  SUB: 1, SUP: 1, BR: 1, HR: 1, TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1, FIGURE: 1,
    FIGCAPTION: 1, IMG: 1, SPAN: 1, DIV: 1, SECTION: 1,
  ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, DL: 1, DT: 1, DD: 1, ABBR: 1, CITE: 1, Q: 1, MARK: 1, TIME: 1, DETAILS: 1,
    SUMMARY: 1, KBD: 1, VAR: 1, SAMP: 1 };
var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1,
  NOSCRIPT: 1, LINK: 1, META: 1, TEMPLATE: 1,
  SVG: 1, MATH: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1, TRACK: 1, NAV: 1, ASIDE: 1, DIALOG: 1, FRAME: 1,
    FRAMESET: 1, APPLET: 1, BASE: 1, PORTAL: 1 };
var JUNK = ('.mw-editsection,.navbox,.vertical-navbox,.metadata,.ambox,.hatnote,.noprint,.mw-empty-elt,.reflist '
  + '.mw-cite-backlink,.sistersitebox,.mw-jump-link,[role=navigation],[aria-hidden=true],.cookie,.advert,.ads,.ad');

function sanitize(html, base, opts) {
  opts = opts || {};
  var doc = new DOMParser().parseFromString(String(html).slice(0, MAX_PAGE), 'text/html');
  var title = (doc.querySelector('title') || {}).textContent || '';
  var src = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role=main]') || doc.body;
  if (!src) return { html: '', text: '', title: title, links: [] };
  try { src.querySelectorAll(JUNK).forEach(function (n) { n.remove(); }); } catch (e) {}
  var out = document.createElement('div'), links = [];
  function walk(node, parent, depth) {
    if (depth > 40) return;
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { parent.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toUpperCase();
      if (DROP[tag]) return;
      if (!ALLOWED[tag]) { walk(n, parent, depth + 1); return; }  // unwrap unknown tags, keep text
      var el = document.createElement(tag);
      if (tag === 'A') {
        var href = U.resolve(n.getAttribute('href') || '', base);
        if (href && /^https?:/i.test(href)) {
          el.setAttribute('href', href); el.setAttribute('data-nav', href); el.setAttribute('rel',
            'noopener noreferrer nofollow');
          if (links.length < 400) links.push({ url: href, text: (n.textContent || '').trim().slice(0, 140) });
        } else if (/^#/.test(n.getAttribute('href') || '')) el.setAttribute('href', n.getAttribute('href'));
      } else if (tag === 'IMG') {
        var s = U.resolve(n.getAttribute('src') || n.getAttribute('data-src') || '', base);
        if (!s || !/^https:/i.test(s)) return;
        if (opts.loadImages === false) { var ph = document.createElement('span'); ph.className = 'cb-img-off';
          ph.textContent = '[image: ' + (n.getAttribute('alt') || 'hidden') + ']'; parent.appendChild(ph); return; }
        el.setAttribute('src', s); el.setAttribute('alt', n.getAttribute('alt') || ''); el.setAttribute('loading',
          'lazy'); el.setAttribute('referrerpolicy', 'no-referrer'); el.setAttribute('decoding', 'async');
        ['width', 'height'].forEach(function (a) { var v = parseInt(n.getAttribute(a), 10);
          if (v > 0 && v < 4000) el.setAttribute(a, v); });
      } else if (tag === 'TH' || tag === 'TD') {
        ['colspan', 'rowspan'].forEach(function (a) { var v = parseInt(n.getAttribute(a), 10);
          if (v > 1 && v < 50) el.setAttribute(a, v); });
      }
      var t = n.getAttribute('title'); if (t && tag !== 'IMG') el.setAttribute('title', t.slice(0, 200));
      if (n.id && /^[\w-]{1,60}$/.test(n.id)) el.id = 'cb-' + n.id;
      parent.appendChild(el); walk(n, el, depth + 1);
    });
  }
  walk(src, out, 0);
  // drop empty wrappers
  out.querySelectorAll('div,span,section,p').forEach(function (n) { if (!n.textContent.trim() && !n.querySelector(
    'img,hr,br,table')) n.remove(); });
  var text = (out.textContent || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return { html: out.innerHTML, text: text, title: title.trim(), links: links };
}

export { sanitize };
