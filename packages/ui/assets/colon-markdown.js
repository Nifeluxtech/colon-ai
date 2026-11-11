/* ColonMarkdown: safe, dependency-free Markdown → HTML for AI replies.
   - Everything is HTML-escaped first; only the tags this file emits can appear.
   - GFM subset: headings, paragraphs, bold/italic/strike, inline code, links (http/https/mailto only),
     autolinks, lists (nested, ordered, task), blockquotes, rules, tables with alignment, fenced code.
   - Code highlighting for js/ts/json/python/sql/html/css/bash/php/java/c/go/rust (lightweight tokenizer).
   - Maths: $inline$, $$display$$, \( \) and \[ \] via a small TeX subset renderer (fractions, roots,
     powers, subscripts, Greek, operators). Uses window.katex instead when a page has loaded it.
   - Citations: [1], [2] → superscript chips (data-cite="1"), resolved by the app against message sources.
   - Streaming-safe: an unclosed code fence renders as code so partial replies look right.
   Works in browsers (window.ColonMarkdown) and Node (module.exports) for unit tests. */
(function (root) {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function safeUrl(u) {
    u = String(u || '').trim().replace(/[\u0000-\u001f\s]+/g, '');
    if (/^(https?:|mailto:)/i.test(u) || /^#[\w-]*$/.test(u)) return u;
    if (/^www\.[\w-]+\./i.test(u)) return 'https://' + u;
    return null;
  }

  /* ---------- Syntax highlighting ---------- */
  var KW = {
    js: 'await async break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield interface type enum implements private public protected readonly as',
    python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self print',
    sql: 'select from where insert into values update set delete create table alter drop index primary key foreign references join left right inner outer on group by order having limit offset as and or not null is in like between distinct count sum avg min max case when then else end union all exists default auto_increment varchar int bigint text datetime timestamp',
    bash: 'if then else elif fi for while do done case esac function in return export local echo cd ls cat grep sed awk sudo npm node git curl mkdir rm cp mv chmod source',
    php: 'abstract and array as break case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global if implements include instanceof interface isset list namespace new or print private protected public require return static switch throw trait try unset use var while yield true false null',
    c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected new delete this true false null package import extends implements interface final try catch throw throws string bool func go defer chan map range struct type var fn let mut impl trait pub use mod match loop where self crate async await',
    css: ''
  };
  var ALIAS = { javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', node: 'js', json: 'json', py: 'python', python3: 'python',
    sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', mysql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql',
    html: 'html', xml: 'html', svg: 'html', vue: 'html', css: 'css', scss: 'css', less: 'css', php: 'php',
    java: 'c', c: 'c', cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', go: 'c', golang: 'c', rust: 'c', rs: 'c', kotlin: 'c', kt: 'c', swift: 'c', dart: 'c' };
  var kwSets = {};
  function kwSet(lang) {
    if (!kwSets[lang]) { var o = {}; (KW[lang] || '').split(' ').forEach(function (w) { if (w) o[w] = 1; }); kwSets[lang] = o; }
    return kwSets[lang];
  }
  function span(cls, text) { return '<span class="tok-' + cls + '">' + esc(text) + '</span>'; }

  function highlight(code, lang) {
    var l = ALIAS[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
    if (l === 'html') return highlightHtml(code);
    if (l === 'json') return code.replace(/("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(true|false|null)\b|([\s\S])/gi, function (m, str, colon, num, lit, other) {
      if (str) return span(colon ? 'attr' : 'str', str) + (colon ? esc(colon) : '');
      if (num) return span('num', num); if (lit) return span('kw', lit); return esc(other);
    });
    if (!KW[l] && l !== 'css') return esc(code);
    var ci = l === 'sql', kws = kwSet(l);
    var comment = l === 'python' || l === 'bash' ? '#[^\\n]*' : l === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' : l === 'css' ? '\\/\\*[\\s\\S]*?\\*\\/' : l === 'php' ? '\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
    var strings = l === 'python' ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'' : '`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'';
    if (l === 'css') {
      return code.replace(new RegExp('(' + comment + ')|(' + strings + ')|(#[0-9a-fA-F]{3,8}\\b|-?\\b\\d+(?:\\.\\d+)?(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?)|([a-zA-Z-]+)(?=\\s*:)|([.#]?[a-zA-Z_][\\w-]*)|([\\s\\S])', 'g'),
        function (m, c, s, n, prop, ident, other) {
          if (c) return span('com', c); if (s) return span('str', s); if (n) return span('num', n); if (prop) return span('attr', prop);
          if (ident) return /^[.#]/.test(ident) ? span('fn', ident) : esc(ident); return esc(other);
        });
    }
    var re = new RegExp('(' + comment + ')|(' + strings + ')|(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)|(\\$?[A-Za-z_][\\w]*)(\\s*\\()?|([\\s\\S])', 'g');
    return code.replace(re, function (m, c, s, n, ident, call, other) {
      if (c) return span('com', c);
      if (s) return span('str', s);
      if (n) return span('num', n);
      if (ident) {
        var key = ci ? ident.toLowerCase() : ident;
        if (kws[key]) return span('kw', ident) + (call ? esc(call) : '');
        if (call) return span('fn', ident) + esc(call);
        if (/^[A-Z][a-zA-Z0-9]+$/.test(ident) && l !== 'sql') return span('type', ident);
        return esc(ident);
      }
      return esc(other);
    });
  }
  function highlightHtml(code) {
    return code.replace(/(<!--[\s\S]*?-->)|(<\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)(\s*\/?>)|([\s\S])/g,
      function (m, com, open, tag, attrs, close, other) {
        if (com) return span('com', com);
        if (tag) {
          var a = attrs.replace(/([^\s=]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?|(\s+)/g, function (mm, name, eq, val, ws) {
            if (ws) return ws; return span('attr', name) + (eq ? esc(eq) : '') + (val ? span('str', val) : '');
          });
          return esc(open) + span('kw', tag) + a + esc(close);
        }
        return esc(other);
      });
  }

  /* ---------- Maths (TeX subset) ---------- */
  var SYM = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', cong: '≅', propto: '∝',
    infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', mapsto: '↦',
    sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', partial: '∂', nabla: '∇', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨', circ: '∘', degree: '°', angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴', because: '∵',
    ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', prime: '′', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', star: '⋆', bullet: '•', triangle: '△', square: '□',
    langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', mid: '∣', vert: '|', Vert: '‖', quad: '\u2003', qquad: '\u2003\u2003',
    '{': '{', '}': '}', '%': '%', '$': '$', '&': '&', '#': '#', '_': '_', '|': '‖'
  };
  var OPS = { sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, arcsin: 1, arccos: 1, arctan: 1, sinh: 1, cosh: 1, tanh: 1, log: 1, ln: 1, lg: 1, exp: 1, lim: 1, max: 1, min: 1, sup: 1, inf: 1, det: 1, gcd: 1, deg: 1, dim: 1, mod: 1, arg: 1 };

  function tex(src) {
    var s = String(src), i = 0, n = s.length;
    function readName() {
      var m = /^[a-zA-Z]+/.exec(s.slice(i)); if (m) { i += m[0].length; return m[0]; }
      return s[i++] || '';
    }
    function skipWs() { while (i < n && /\s/.test(s[i])) i++; }
    function rawGroup() { // text inside {...} without parsing
      skipWs(); if (s[i] !== '{') return esc(s[i++] || '');
      var depth = 0, start = ++i;
      for (; i < n; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { if (!depth) break; depth--; } }
      var t = s.slice(start, i); i++; return esc(t);
    }
    function arg() {
      skipWs();
      if (s[i] === '{') { i++; return expr('}'); }
      if (s[i] === '\\') { i++; return command(readName()); }
      return atom(s[i++] || '');
    }
    function atom(c) {
      if (/[a-zA-Z]/.test(c)) return '<i>' + c + '</i>';
      if (c === '-') return '−';
      if (/[=+<>]/.test(c)) return '<span class="m-op">' + esc(c) + '</span>';
      if (c === '~') return '\u00a0';
      return esc(c);
    }
    function command(name) {
      switch (name) {
        case 'frac': case 'dfrac': case 'tfrac': { var a = arg(), b = arg(); return '<span class="m-frac"><span class="m-num">' + a + '</span><span class="m-den">' + b + '</span></span>'; }
        case 'sqrt': {
          var idx = ''; skipWs();
          if (s[i] === '[') { var end = s.indexOf(']', i); idx = '<sup class="m-idx">' + esc(s.slice(i + 1, end)) + '</sup>'; i = end + 1; }
          return '<span class="m-sqrt">' + idx + '√<span class="m-rad">' + arg() + '</span></span>';
        }
        case 'text': case 'textrm': case 'mathrm': case 'operatorname': case 'textit': return '<span class="m-text">' + rawGroup() + '</span>';
        case 'mathbf': case 'textbf': case 'boldsymbol': return '<b>' + arg() + '</b>';
        case 'mathit': return '<i>' + arg() + '</i>';
        case 'overline': case 'bar': return '<span class="m-over">' + arg() + '</span>';
        case 'vec': return '<span class="m-vec">' + arg() + '</span>';
        case 'hat': return arg() + '\u0302';
        case 'left': case 'right': case 'big': case 'Big': case 'bigg': case 'Bigg': { skipWs(); if (s[i] === '.') { i++; return ''; } if (s[i] === '\\') { i++; return command(readName()); } return esc(s[i++] || ''); }
        case 'displaystyle': case 'limits': case 'nolimits': case '!': return '';
        case ',': case ':': case ';': case ' ': return '\u2009';
        case '\\': return '<br>';
        case 'begin': case 'end': rawGroup(); return '';
      }
      if (OPS[name]) return '<span class="m-fn">' + name + '</span>';
      if (SYM[name] !== undefined) return '<span class="m-sym">' + esc(SYM[name]) + '</span>';
      return '<span class="m-text">' + esc(name) + '</span>';
    }
    function expr(stop) {
      var out = '';
      while (i < n) {
        var c = s[i];
        if (stop && c === stop) { i++; return out; }
        if (c === '{') { i++; out += expr('}'); continue; }
        if (c === '}') { i++; continue; }
        if (c === '\\') { i++; out += command(readName()); continue; }
        if (c === '^') { i++; out += '<sup>' + arg() + '</sup>'; continue; }
        if (c === '_') { i++; out += '<sub>' + arg() + '</sub>'; continue; }
        if (c === '&') { i++; out += '\u2003'; continue; }
        if (/\s/.test(c)) { i++; if (!/\s$/.test(out)) out += ' '; continue; }
        i++; out += atom(c);
      }
      return out;
    }
    return expr(null).trim();
  }
  function math(src, display) {
    var k = root && root.katex;
    if (k && k.renderToString) {
      try { return k.renderToString(src, { displayMode: !!display, throwOnError: false, output: 'html' }); } catch (e) { /* fall through */ }
    }
    var body = tex(src);
    return display ? '<div class="math-block" role="math" aria-label="' + esc(src) + '">' + body + '</div>'
      : '<span class="math" role="math" aria-label="' + esc(src) + '">' + body + '</span>';
  }

  /* ---------- Inline ---------- */
  function inline(text, ctx) {
    var slots = [];
    function hold(html) { slots.push(html); return '\u0000' + (slots.length - 1) + '\u0000'; }
    var t = String(text);
    // code spans first (verbatim)
    t = t.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (m, ticks, code) { return hold('<code>' + esc(code.replace(/^ (.*) $/, '$1')) + '</code>'); });
    // maths
    t = t.replace(/\\\(([\s\S]+?)\\\)/g, function (m, x) { return hold(math(x, false)); });
    t = t.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, function (m, pre, x) {
      if (/^\d+([.,]\d+)?$/.test(x)) return m; // "$5" style money, not maths
      return pre + hold(math(x, false));
    });
    // links [text](url "title")
    t = t.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, function (m, label, url, title) {
      var u = safeUrl(url); if (!u) return m;
      return hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer nofollow"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + inlineBasic(esc(label)) + '</a>');
    });
    // autolinks
    t = t.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])/g, function (m, pre, url) {
      var u = safeUrl(url); if (!u) return m;
      return pre + hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(url) + '</a>');
    });
    // citations [1] [2,3] [^1]
    if (ctx.citations !== false) {
      t = t.replace(/\[\^?(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, function (m, nums) {
        return hold(nums.split(/\s*,\s*/).map(function (k) {
          var src = ctx.sources && ctx.sources[Number(k) - 1];
          return '<sup class="cite"><a href="' + (src && safeUrl(src.url) ? esc(src.url) : '#') + '" data-cite="' + k + '"' + (src ? ' title="' + esc(src.title || src.url) + '" target="_blank" rel="noopener noreferrer nofollow"' : '') + '>' + k + '</a></sup>';
        }).join(''));
      });
    }
    t = inlineBasic(esc(t));
    for (var pass = 0; pass < 4 && t.indexOf('\u0000') > -1; pass++) t = t.replace(/\u0000(\d+)\u0000/g, function (m, k) { return slots[Number(k)]; });
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

  function codeBlock(code, lang, open) {
    var label = lang || 'text';
    return '<div class="md-code' + (open ? ' streaming' : '') + '"><div class="md-code-head"><span>' + esc(label) + '</span>' +
      '<button type="button" class="md-copy" data-copy-code aria-label="Copy code">Copy</button></div>' +
      '<pre><code class="lang-' + esc(label) + '">' + highlight(code, lang) + '</code></pre></div>';
  }

  function renderList(lines, ctx) {
    // Build a tree from indentation: deeper indent (2+ spaces more) opens a child list on the last item.
    var stack = [];
    lines.forEach(function (line) {
      var m = RE_LIST.exec(line);
      if (!m) { var cur = stack[stack.length - 1]; var last = cur && cur.list.items[cur.list.items.length - 1]; if (last) last.text += '\n' + line.trim(); return; }
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
      return '<' + tag + (list.ordered && list.start > 1 ? ' start="' + list.start + '"' : '') + '>' + list.items.map(function (it) {
        var task = /^\[([ xX])\]\s+/.exec(it.text), body = task ? it.text.slice(task[0].length) : it.text;
        return '<li' + (task ? ' class="task"' : '') + '>' + (task ? '<input type="checkbox" disabled' + (task[1] !== ' ' ? ' checked' : '') + '> ' : '') +
          inline(body, ctx).replace(/\n/g, '<br>') + (it.children ? out(it.children) : '') + '</li>';
      }).join('') + '</' + tag + '>';
    }
    return out(rootList);
  }

  function blocks(src, ctx) {
    var lines = src.split('\n'), html = [], i = 0, para = [];
    function flush() { if (para.length) { html.push('<p>' + inline(para.join('\n'), ctx).replace(/\n/g, ' ') + '</p>'); para = []; } }
    while (i < lines.length) {
      var line = lines[i], m;
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = RE_FENCE.exec(line))) {
        flush();
        var fence = m[1], lang = m[2], buf = [], closed = false; i++;
        while (i < lines.length) {
          if (new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[i])) { closed = true; i++; break; }
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
      if ((m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); var lv = Math.min(6, m[1].length + 1); html.push('<h' + lv + '>' + inline(m[2], ctx) + '</h' + lv + '>'); i++; continue; }
      if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        flush(); var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        html.push('<blockquote>' + blocks(q.join('\n'), ctx) + '</blockquote>');
        continue;
      }
      if (line.indexOf('|') > -1 && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].indexOf('-') > -1) {
        flush();
        var head = splitRow(line), aligns = splitRow(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''; });
        i += 2; var rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') > -1) { rows.push(splitRow(lines[i])); i++; }
        var al = function (k) { return aligns[k] ? ' style="text-align:' + aligns[k] + '"' : ''; };
        html.push('<div class="md-table" tabindex="0"><table><thead><tr>' + head.map(function (c, k) { return '<th' + al(k) + '>' + inline(c, ctx) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + head.map(function (_, k) { return '<td' + al(k) + '>' + inline(r[k] || '', ctx) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if (RE_LIST.test(line) && !(para.length && !/^\s*([-*+]|1[.)])\s/.test(line))) {
        flush(); var items = [], first = RE_LIST.exec(line), baseIndent = first[1].length, firstOrdered = /\d/.test(first[2]);
        while (i < lines.length) {
          var l2 = lines[i], lm = RE_LIST.exec(l2);
          if (lm && items.length && lm[1].length <= baseIndent && /\d/.test(lm[2]) !== firstOrdered) break;
          if (lm || (/^\s{2,}\S/.test(l2) && items.length)) { items.push(l2); i++; continue; }
          if (!l2.trim() && i + 1 < lines.length && (RE_LIST.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) { i++; continue; }
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

  function render(src, opts) {
    var ctx = Object.assign({ sources: null, citations: true }, opts || {});
    var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    return blocks(text, ctx);
  }

  // Plain text (for copy / previews): strips Markdown syntax.
  function toText(src) {
    return String(src || '').replace(/```[\w+-]*\n?/g, '').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/^\s*>\s?/gm, '').trim();
  }

  var api = { render: render, highlight: highlight, tex: tex, math: math, inline: function (t, o) { return inline(t, Object.assign({ citations: true }, o)); }, escape: esc, safeUrl: safeUrl, toText: toText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ColonMarkdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
