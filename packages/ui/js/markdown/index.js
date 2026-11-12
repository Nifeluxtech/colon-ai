/* ColonMarkdown: safe, dependency-free Markdown → HTML for AI replies.
   - Everything is HTML-escaped first; only the tags this file emits can appear.
   - GFM subset: headings, paragraphs, bold/italic/strike, inline code, links (http/https/mailto only),
     autolinks, lists (nested, ordered, task), blockquotes, rules, tables with alignment, fenced code.
   - Code highlighting for js/ts/json/python/sql/html/css/bash/php/java/c/go/rust (lightweight tokenizer).
   - Maths: $inline$, $$display$$, \( \) and \[ \] via a small TeX subset renderer (fractions, roots,
     powers, subscripts, Greek, operators). Uses window.katex instead when a page has loaded it.
   - Citations: [1], [2] → superscript chips (data-cite="1"), resolved by the app against message sources.
   - Streaming-safe: an unclosed code fence renders as code so partial replies look right.
   Works in browsers (window.ColonMarkdown) and Node (ES module import) for unit tests.
   Parts: escape.js, parse.js (blocks and inline), code-blocks.js, math.js. */

import { highlight } from './code-blocks.js';
import { esc, safeUrl } from './escape.js';
import { math, tex } from './math.js';
import { blocks, inline } from './parse.js';

function render(src, opts) {
  var ctx = Object.assign({ sources: null, citations: true }, opts || {});
  var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  return blocks(text, ctx);
}

// Plain text (for copy / previews): strips Markdown syntax.
function toText(src) {
  return String(src || '').replace(/```[\w+-]*\n?/g, '').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g,
    '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/^\s*>\s?/gm, '').trim();
}

var api = { render: render, highlight: highlight, tex: tex, math: math, inline: function (t, o) { return inline(t,
  Object.assign({ citations: true }, o)); }, escape: esc, safeUrl: safeUrl, toText: toText };
if (typeof window !== 'undefined') window.ColonMarkdown = api;

export { api as ColonMarkdown };
