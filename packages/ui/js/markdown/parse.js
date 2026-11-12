/* ColonMarkdown · block and inline parsing: paragraphs, headings, lists, tables, quotes, emphasis, links,
   citations. */

import { codeBlock } from './code-blocks.js';
import { esc, safeUrl } from './escape.js';
import { math } from './math.js';

/* ---------- Inline ---------- */
function inline(text, ctx) {
  var slots = [];
  function hold(html) { slots.push(html); return '\u0000' + (slots.length - 1) + '\u0000'; }
  var t = String(text);
  // code spans first (verbatim)
  t = t.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (m, ticks, code) { return hold('<code>' + esc(code.replace(
    /^ (.*) $/, '$1')) + '</code>'); });
  // maths
  t = t.replace(/\\\(([\s\S]+?)\\\)/g, function (m, x) { return hold(math(x, false)); });
  t = t.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, function (m, pre, x) {
    if (/^\d+([.,]\d+)?$/.test(x)) return m; // "$5" style money, not maths
    return pre + hold(math(x, false));
  });
  // links [text](url "title")
  t = t.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, function (m, label, url, title) {
    var u = safeUrl(url); if (!u) return m;
    return hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer nofollow"' + (title ? ' title="'
      + esc(title) + '"' : '') + '>' + inlineBasic(esc(label)) + '</a>');
  });
  // autolinks
  t = t.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])/g, function (m, pre, url) {
    var u = safeUrl(url); if (!u) return m;
    return pre + hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(url)
      + '</a>');
  });
  // citations [1] [2,3] [^1]
  if (ctx.citations !== false) {
    t = t.replace(/\[\^?(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, function (m, nums) {
      return hold(nums.split(/\s*,\s*/).map(function (k) {
        var src = ctx.sources && ctx.sources[Number(k) - 1];
        return '<sup class="cite"><a href="' + (src && safeUrl(src.url) ? esc(src.url) : '#') + '" data-cite="' + k
          + '"' + (src ? ' title="' + esc(src.title || src.url)
          + '" target="_blank" rel="noopener noreferrer nofollow"' : '') + '>' + k + '</a></sup>';
      }).join(''));
    });
  }
  t = inlineBasic(esc(t));
  for (var pass = 0; pass < 4 && t.indexOf('\u0000') > -1; pass++) t = t.replace(/\u0000(\d+)\u0000/g, function (m,
    k) { return slots[Number(k)]; });
  return t;
}
function inlineBasic(h) { // h is already escaped
  return h
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__(?!\w)/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/ {2,}\n|\\\n/g, '<br>');
}

/* ---------- Blocks ---------- */
var RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
var RE_LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
var RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line) {
  var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  var cells = [], cur = '', code = false;
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (c === '`') code = !code;
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function renderList(lines, ctx) {
  // Build a tree from indentation: deeper indent (2+ spaces more) opens a child list on the last item.
  var stack = [];
  lines.forEach(function (line) {
    var m = RE_LIST.exec(line);
    if (!m) { var cur = stack[stack.length - 1]; var last = cur && cur.list.items[cur.list.items.length - 1];
      if (last) last.text += '\n' + line.trim(); return; }
    var indent = m[1].replace(/\t/g, '    ').length, ordered = /\d/.test(m[2]);
    var mk = function () { return { items: [], ordered: ordered, start: ordered ? parseInt(m[2], 10) : 1 }; };
    if (!stack.length) stack.push({ list: mk(), indent: indent });
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    var top = stack[stack.length - 1];
    if (indent >= top.indent + 2 && top.list.items.length) {
      var child = mk(); top.list.items[top.list.items.length - 1].children = child;
      stack.push({ list: child, indent: indent }); top = stack[stack.length - 1];
    }
    top.list.items.push({ text: m[3], children: null });
  });
  var rootList = stack.length ? stack[0].list : { items: [] };
  function out(list) {
    var tag = list.ordered ? 'ol' : 'ul';
    return '<' + tag + (list.ordered && list.start > 1 ? ' start="' + list.start + '"' : '') + '>' + list.items.map(
      function (it) {
      var task = /^\[([ xX])\]\s+/.exec(it.text), body = task ? it.text.slice(task[0].length) : it.text;
      return '<li' + (task ? ' class="task"' : '') + '>' + (task ? '<input type="checkbox" disabled' + (task[1] !== ' '
        ? ' checked' : '') + '> ' : '') +
        inline(body, ctx).replace(/\n/g, '<br>') + (it.children ? out(it.children) : '') + '</li>';
    }).join('') + '</' + tag + '>';
  }
  return out(rootList);
}

function blocks(src, ctx) {
  var lines = src.split('\n'), html = [], i = 0, para = [];
  function flush() { if (para.length) { html.push('<p>' + inline(para.join('\n'), ctx).replace(/\n/g, ' ') + '</p>');
    para = []; } }
  while (i < lines.length) {
    var line = lines[i], m;
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = RE_FENCE.exec(line))) {
      flush();
      var fence = m[1], lang = m[2], buf = [], closed = false; i++;
      while (i < lines.length) {
        if (new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[i])) { closed = true; i++;
          break; }
        buf.push(lines[i]); i++;
      }
      html.push(codeBlock(buf.join('\n'), lang, !closed));
      continue;
    }
    if (/^\s*(\$\$|\\\[)/.test(line)) {
      flush();
      var close = /^\s*\$\$/.test(line) ? '$$' : '\\]', body = line.replace(/^\s*(\$\$|\\\[)/, '');
      var endIdx = body.indexOf(close);
      if (endIdx > -1) { html.push(math(body.slice(0, endIdx), true)); i++; continue; }
      var mbuf = [body]; i++;
      while (i < lines.length && lines[i].indexOf(close) === -1) { mbuf.push(lines[i]); i++; }
      if (i < lines.length) { mbuf.push(lines[i].slice(0, lines[i].indexOf(close))); i++; }
      html.push(math(mbuf.join('\n'), true));
      continue;
    }
    if ((m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); var lv = Math.min(6, m[1].length + 1);
      html.push('<h' + lv + '>' + inline(m[2], ctx) + '</h' + lv + '>'); i++; continue; }
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush(); var q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html.push('<blockquote>' + blocks(q.join('\n'), ctx) + '</blockquote>');
      continue;
    }
    if (line.indexOf('|') > -1 && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].indexOf(
      '-') > -1) {
      flush();
      var head = splitRow(line), aligns = splitRow(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c)
        ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''; });
      i += 2; var rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') > -1) { rows.push(splitRow(lines[i])); i++; }
      var al = function (k) { return aligns[k] ? ' style="text-align:' + aligns[k] + '"' : ''; };
      html.push('<div class="md-table" tabindex="0"><table><thead><tr>' + head.map(function (c, k) { return '<th'
        + al(k) + '>' + inline(c, ctx) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + head.map(function (_, k) { return '<td' + al(k) + '>' + inline(r[k]
          || '', ctx) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
      continue;
    }
    if (RE_LIST.test(line) && !(para.length && !/^\s*([-*+]|1[.)])\s/.test(line))) {
      flush(); var items = [], first = RE_LIST.exec(line), baseIndent = first[1].length, firstOrdered = /\d/.test(first[
        2]);
      while (i < lines.length) {
        var l2 = lines[i], lm = RE_LIST.exec(l2);
        if (lm && items.length && lm[1].length <= baseIndent && /\d/.test(lm[2]) !== firstOrdered) break;
        if (lm || (/^\s{2,}\S/.test(l2) && items.length)) { items.push(l2); i++; continue; }
        if (!l2.trim() && i + 1 < lines.length && (RE_LIST.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) {
          i++; continue; }
        break;
      }
      html.push(renderList(items, ctx));
      continue;
    }
    para.push(line); i++;
  }
  flush();
  return html.join('');
}

export { blocks, inline };
