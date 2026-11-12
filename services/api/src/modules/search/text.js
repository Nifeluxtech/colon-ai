// HTML -> readable text for the page reader, plus the small text helpers the search parsers share.
// Regex-based on purpose: no DOM library on 1 GB shared hosting. Good enough to keep a page's title and its
// main paragraphs; scripts, styles, navigation, headers, footers, forms and asides are dropped.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', deg: '°', times: '×', divide: '÷', euro: '€', pound: '£', naira: '₦', ngn: '₦', shy: '' };

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    const v = NAMED[e.toLowerCase()];
    return v == null ? m : v;
  });
}

const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const DROP = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'object', 'canvas', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'figure', 'menu', 'dialog'];
// Elements whose class/id says "chrome, not content".
const JUNK_ATTR = /\b(nav|navbar|menu|breadcrumb|footer|header|sidebar|cookie|consent|banner|advert|ads?|promo|share|social|related|newsletter|subscribe|comment|popup|modal|skip)\b/i;

function dropBlocks(html, tag) {
  return html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ').replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
}

// Picks <article> or <main> when the page has one with real text in it.
function mainPart(html) {
  for (const tag of ['article', 'main']) {
    const parts = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi'))].map(m => m[1]);
    const best = parts.sort((a, b) => b.length - a.length)[0];
    if (best && stripTags(best).length > 400) return best;
  }
  const role = /<[a-z]+[^>]*\brole=["']main["'][^>]*>([\s\S]*)/i.exec(html);
  if (role && stripTags(role[1]).length > 400) return role[1];
  return html;
}

/**
 * htmlToText(html) -> { title, text, lang }   text: paragraphs separated by blank lines.
 */
function htmlToText(html) {
  html = String(html || '');
  const title = stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '') ||
    decodeEntities((/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html) || [])[1] || '');
  const lang = ((/<html[^>]*\blang=["']?([a-z]{2,3})/i.exec(html) || [])[1] || '').toLowerCase();
  let body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) || [null, html])[1];
  body = body.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const t of ['script', 'style', 'noscript', 'svg', 'template']) body = dropBlocks(body, t);
  body = mainPart(body);
  for (const t of DROP) body = dropBlocks(body, t);
  // Divs and lists marked as menus, cookie banners, share bars... (shallow: the opening tag to its first close).
  body = body.replace(/<(div|section|ul|ol|p|span)\b([^>]*)>[\s\S]*?<\/\1>/gi, (m, tag, attrs) => (JUNK_ATTR.test((/\b(?:class|id)=["']([^"']*)/i.exec(attrs) || [])[1] || '') ? ' ' : m));
  body = body
    .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, h, t) => `\n\n${stripTags(t)}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|li|tr|table|blockquote|pre|ul|ol|dd|dt)>/gi, '\n\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ');
  const text = decodeEntities(body.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .split(/\n\s*\n+/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(p => p.length >= 40 || (p.length >= 3 && /^[^•|]{3,80}$/.test(p) && !/[.,;:]$/.test(p) && /[A-Za-zÀ-ɏḀ-ỿ]/.test(p) && p.split(' ').length <= 10))
    .filter((p, i, all) => all.indexOf(p) === i)
    .join('\n\n');
  return { title: title.slice(0, 300), text: dropShortRuns(text), lang };
}

// Drops runs of 3+ short lines (menus that survived) while keeping headings before real paragraphs.
function dropShortRuns(text) {
  const ps = text.split('\n\n');
  const out = [];
  for (let i = 0; i < ps.length; i++) {
    const short = ps[i].length < 40;
    if (!short) { out.push(ps[i]); continue; }
    const next = ps[i + 1];
    if (next && next.length >= 40) out.push(ps[i]);   // a heading for the paragraph after it
  }
  return out.join('\n\n').trim();
}

const STOP = new Set('a an the and or but of in on at to for from by with about as is are was were be been being it its this that these those what which who whom whose when where why how do does did can could should would will shall may might must i me my we our you your he she they them their his her not no yes than then so if into over under up down out more most less least very just also please tell explain give show find research search look information info current latest today now recent new ehn abeg'.split(' '));

const words = (s) => (String(s || '').toLowerCase().normalize('NFC').match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu) || []);
const keywords = (s) => words(s).filter(w => !STOP.has(w) && (w.length > 1 || /\d/.test(w)));

/**
 * pickRelevant(text, query, max) -> text of at most `max` chars: the opening paragraph, then the paragraphs
 * that share the most words with the query, kept in page order.
 */
function pickRelevant(text, query, max = 2500) {
  text = String(text || '').trim();
  if (text.length <= max) return text;
  const ps = text.split(/\n\n+/);
  const q = new Set(keywords(query));
  const scored = ps.map((p, i) => {
    const ws = words(p);
    let hit = 0;
    for (const w of ws) if (q.has(w)) hit++;
    return { i, p, score: (i === 0 ? 3 : 0) + hit * 2 + (/\d/.test(p) ? 0.5 : 0) - (p.length > 1500 ? 1 : 0) };
  });
  const chosen = [];
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (used >= max) break;
    const room = max - used;
    if (s.p.length > room && room < 200) continue;
    const piece = s.p.length > room ? cut(s.p, room) : s.p;
    if (piece.length < 60 && s.p.length > 60) continue;
    chosen.push({ i: s.i, p: piece });
    used += piece.length + 2;
  }
  return chosen.sort((a, b) => a.i - b.i).map(c => c.p).join('\n\n').slice(0, max);
}

function cut(s, n) {
  if (s.length <= n) return s;
  const t = s.slice(0, n - 1);
  const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('? '), t.lastIndexOf('! '));
  return (end > n * 0.5 ? t.slice(0, end + 1) : t.replace(/\s+\S*$/, '')) + '…';
}

module.exports = { htmlToText, stripTags, decodeEntities, pickRelevant, keywords, words, cut, STOP };
