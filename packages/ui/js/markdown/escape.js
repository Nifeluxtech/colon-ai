/* ColonMarkdown · HTML escaping and the link/image URL allow-list; the global object (window, or globalThis
   under Node) for optional page libraries such as KaTeX. */

// The page's global object in the browser; globalThis under Node (unit tests).
const root = typeof window !== 'undefined' ? window : globalThis;

var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

function safeUrl(u) {
  u = String(u || '').trim().replace(/[\u0000-\u001f\s]+/g, '');
  if (/^(https?:|mailto:)/i.test(u) || /^#[\w-]*$/.test(u)) return u;
  if (/^www\.[\w-]+\./i.test(u)) return 'https://' + u;
  return null;
}

export { esc, root, safeUrl };
