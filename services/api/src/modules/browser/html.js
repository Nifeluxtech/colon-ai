// Server-side reader sanitiser (Phase 8): untrusted HTML -> safe reader HTML, plus title, byline, lang and text.
// Same tag allow-list and drop-list as the web client (packages/ui/js/browser/sanitize.js), which sanitises the
// result again on the device (defence in depth), so this side is conservative rather than perfect. Regex
// tokenizer on purpose: no DOM library on 1 GB shared hosting. Unknown tags are unwrapped (their text kept),
// dropped tags lose their whole content, every attribute not listed below is removed (all on*, style, class).
const search = require('../search');

const { stripTags } = search.text;
// Accented letters common in African and European names, on top of the search module's entity table.
const MORE = { eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', oacute: 'ó',
  ograve: 'ò', ocirc: 'ô', uacute: 'ú', ugrave: 'ù', iacute: 'í', igrave: 'ì', ccedil: 'ç', ntilde: 'ñ', auml: 'ä',
  ouml: 'ö', uuml: 'ü', szlig: 'ß', Eacute: 'É', Egrave: 'È', Aacute: 'Á', Oacute: 'Ó', Ntilde: 'Ñ' };
const decodeEntities = (s) => search.text.decodeEntities(String(s || '').replace(/&([A-Za-z]+);/g,
  (m, k) => MORE[k] || m));

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));
const ALLOWED = set(`p h1 h2 h3 h4 h5 h6 a ul ol li blockquote pre code em strong b i u s small sub sup br hr
  table thead tbody tfoot tr th td caption figure figcaption img span div section article header footer main dl dt
  dd abbr cite q mark time details summary kbd var samp`);
const DROP = set(`script style iframe object embed form input button select textarea noscript link meta template svg
  math canvas video audio source track nav aside dialog frame frameset applet base portal head title map
  label fieldset option optgroup datalist output progress meter`);
// Raw-text elements: their content is skipped by searching for the closing tag, not by tokenizing it.
const RAW = set('script style textarea noscript template iframe xmp title svg math');
const VOID = set('br hr img input meta link source track wbr area base col embed param keygen');
const JUNK_CLASS = new RegExp(String.raw`(^|\s)(mw-editsection|navbox|vertical-navbox|metadata|ambox|hatnote|`
  + String.raw`noprint|mw-empty-elt|mw-cite-backlink|sistersitebox|mw-jump-link|cookie|advert|ads|ad)(\s|$)`, 'i');
const TOKEN = new RegExp(String.raw`<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[!?][^>]*>|`
  + String.raw`<\/([a-zA-Z][\w:-]*)[^>]*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g');
const MAX_DEPTH = 40;
const MAX_TEXT = 200000;
const SMALL_DATA_IMAGE = /^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]{1,4096}$/i;

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
// Text keeps valid entity references (the browser decodes them) and escapes everything else that could open markup.
const escText = (s) => String(s).replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseAttrs(str) {
  const out = new Map();
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(str || ''))) {
    const k = m[1].toLowerCase();
    if (!out.has(k)) out.set(k, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return out;
}

function absolute(v, base) {
  try { return new URL(String(v || '').trim(), base); } catch { return null; }
}

// Picks <article> or <main> (or role=main) when it holds real text; otherwise the body.
function mainPart(html) {
  const body = (/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html) || /<body\b[^>]*>([\s\S]*)$/i.exec(html)
    || [null, html])[1];
  for (const tag of ['article', 'main']) {
    const parts = [...body.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi'))].map((m) => m[1]);
    const best = parts.sort((a, b) => b.length - a.length)[0];
    if (best && stripTags(best).length > 400) return best;
  }
  const role = /<([a-z]+)\b[^>]*\brole=["']?main\b[^>]*>([\s\S]*)/i.exec(body);
  if (role && stripTags(role[2]).length > 400) return role[2];
  return body;
}

// Attributes the reader keeps, per tag. Returns null when the element itself must go (an image we can't show).
function cleanAttrs(tag, a, base) {
  const out = [];
  if (tag === 'a') {
    const href = (a.get('href') || '').trim();
    if (/^#[\w.:-]{0,100}$/.test(href)) out.push(['href', href]);
    else {
      const u = href && absolute(href, base);
      if (u && (u.protocol === 'http:' || u.protocol === 'https:')) out.push(['href', u.toString()],
        ['rel', 'noopener noreferrer nofollow']);
    }
  } else if (tag === 'img') {
    const raw = (a.get('src') || a.get('data-src') || '').trim();
    let src = null;
    if (SMALL_DATA_IMAGE.test(raw)) src = raw.replace(/\s+/g, '');
    else { const u = raw && absolute(raw, base); if (u && u.protocol === 'https:') src = u.toString(); }
    if (!src) return null;
    out.push(['src', src], ['alt', (a.get('alt') || '').slice(0, 300)], ['loading', 'lazy'],
      ['referrerpolicy', 'no-referrer'], ['decoding', 'async']);
    const srcset = (a.get('srcset') || '').split(',').map((part) => part.trim().split(/\s+/)).filter((p) => p[0])
      .map(([u, d]) => { const x = absolute(u, base); return x && x.protocol === 'https:' ? [x.toString(), d]
        .filter(Boolean).join(' ') : null; });
    if (srcset.length && srcset.every(Boolean)) out.push(['srcset', srcset.join(', ')]);
    for (const k of ['width', 'height']) { const v = parseInt(a.get(k), 10); if (v > 0 && v < 4000) out.push([k, v]); }
  } else if (tag === 'th' || tag === 'td') {
    for (const k of ['colspan', 'rowspan']) { const v = parseInt(a.get(k), 10); if (v > 1 && v < 50) out.push([k, v]); }
  }
  const t = a.get('title');
  if (t && tag !== 'img') out.push(['title', t.slice(0, 200)]);
  const id = a.get('id');
  if (id && /^[\w-]{1,60}$/.test(id)) out.push(['id', 'cb-' + id]);
  return out;
}

const isJunk = (a) => JUNK_CLASS.test(a.get('class') || '') || (a.get('role') || '').toLowerCase() === 'navigation'
  || (a.get('aria-hidden') || '').toLowerCase() === 'true';

/** sanitize(html, baseUrl) -> { html, text } (html: the reader body; text: plain text, ≤ 200 000 characters) */
function sanitize(rawHtml, base) {
  const src = mainPart(String(rawHtml || ''));
  const out = [], stack = [];
  let skip = null, pos = 0, m;
  TOKEN.lastIndex = 0;
  const text = (s) => { if (!skip && s) out.push(escText(s)); };
  const close = (tag) => { const i = stack.lastIndexOf(tag); if (i < 0) return;
    while (stack.length > i) out.push(`</${stack.pop()}>`); };
  while ((m = TOKEN.exec(src))) {
    text(src.slice(pos, m.index));
    pos = TOKEN.lastIndex;
    if (m[1]) {                                    // closing tag
      const tag = m[1].toLowerCase();
      if (skip) { if (tag === skip.tag && --skip.depth === 0) skip = null; continue; }
      if (ALLOWED.has(tag)) close(tag);
      continue;
    }
    if (!m[2]) continue;                           // comment, doctype, CDATA, processing instruction
    const tag = m[2].toLowerCase();
    const selfClosing = /\/\s*$/.test(m[3] || '') || VOID.has(tag);
    if (skip) { if (tag === skip.tag && !selfClosing) skip.depth++; continue; }
    if (RAW.has(tag) && !selfClosing) {            // jump over the raw content in one step
      const end = new RegExp(`</${tag}\\b[^>]*>`, 'ig'); end.lastIndex = pos;
      const e = end.exec(src);
      pos = e ? end.lastIndex : src.length; TOKEN.lastIndex = pos;
      continue;
    }
    const a = parseAttrs(m[3]);
    if (DROP.has(tag) || isJunk(a)) { if (!selfClosing) skip = { tag, depth: 1 }; continue; }
    if (!ALLOWED.has(tag)) continue;               // unknown tag: unwrap, keep its text
    if ((tag === 'p' || tag === 'li') && stack[stack.length - 1] === tag) close(tag);
    if (stack.length >= MAX_DEPTH && !VOID.has(tag)) continue;
    const attrs = cleanAttrs(tag, a, base);
    if (!attrs) continue;
    out.push(`<${tag}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }
  text(src.slice(pos));
  while (stack.length) out.push(`</${stack.pop()}>`);
  let html = out.join('');
  // Drop empty wrappers (repeat: removing one can empty its parent).
  for (let i = 0, before = ''; i < 8 && before !== html; i++) {
    before = html;
    html = html.replace(/<(div|span|section|p)(?:\s[^>]*)?>\s*<\/\1>/g, '');
  }
  return { html, text: toText(html) };
}

function toText(html) {
  return decodeEntities(html.replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|table|blockquote|pre|ul|ol|dd|dt|h[1-6]|figure|header|footer)>/gi,
      '\n\n').replace(/<[^>]*>/g, ''))
    .replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}

/** meta(html) -> { title, byline, lang } read from <title>, <html lang> and the author / site-name meta tags. */
function meta(rawHtml) {
  const html = String(rawHtml || '');
  const head = html.slice(0, 200000);
  const metas = [...head.matchAll(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)].map((x) => parseAttrs(x[1]));
  const get = (k) => { const x = metas.find((a) => (a.get('name') || a.get('property') || '').toLowerCase() === k);
    return x ? (x.get('content') || '').trim() : ''; };
  const title = stripTags((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || '') || get('og:title');
  const author = [get('author'), get('article:author'), get('og:site_name')]
    .find((v) => v && !/^https?:/i.test(v)) || '';
  const lang = ((/<html\b[^>]*\blang=["']?([a-z]{2,3}(?:-[a-z0-9]{2,8})*)/i.exec(head) || [])[1] || '').toLowerCase();
  return { title: title.slice(0, 300), byline: author.slice(0, 200), lang: lang.slice(0, 35) };
}

/** plainToHtml(text) -> reader HTML for a text/plain page (one <p> per paragraph). */
function plainToHtml(text) {
  const paras = String(text || '').slice(0, MAX_TEXT).split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>')}</p>`).join('');
}

const LOGIN_PATH = /(^|\/)(login|log-in|signin|sign-in|sign_in|auth|sso|session\/new|accounts?\/login)(\/|$|\.)/i;
/** looksLikeLogin(rawHtml, readerText, finalUrl) -> true when the page is a sign-in wall rather than content. */
function looksLikeLogin(rawHtml, text, finalUrl) {
  const password = /<input\b[^>]*type\s*=\s*["']?password/i.test(String(rawHtml || ''));
  let onLoginPath = false;
  try { onLoginPath = LOGIN_PATH.test(new URL(finalUrl).pathname); } catch { /* not a URL */ }
  const len = String(text || '').length;
  return (onLoginPath && (password || len < 1500)) || (password && len < 600);
}

module.exports = { sanitize, meta, plainToHtml, looksLikeLogin, toText, ALLOWED, DROP };
