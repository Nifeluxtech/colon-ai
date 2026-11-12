/* ColonMarkdown · fenced code blocks with lightweight syntax highlighting (keywords per language). */

import { esc } from './escape.js';

/* ---------- Syntax highlighting ---------- */
var KW = {
  js: ('await async break case catch class const continue debugger default delete do else export extends false '
    + 'finally for from function if import in instanceof let new null of return static super switch this throw true '
    + 'try typeof undefined var void while with yield interface type enum implements private public protected '
    + 'readonly as'),
  python: ('False None True and as assert async await break class continue def del elif else except finally for '
    + 'from global if import in is lambda nonlocal not or pass raise return try while with yield self print'),
  sql: ('select from where insert into values update set delete create table alter drop index primary key foreign '
    + 'references join left right inner outer on group by order having limit offset as and or not null is in like '
    + 'between distinct count sum avg min max case when then else end union all exists default auto_increment varchar '
    + 'int bigint text datetime timestamp'),
  bash: ('if then else elif fi for while do done case esac function in return export local echo cd ls cat grep sed '
    + 'awk sudo npm node git curl mkdir rm cp mv chmod source'),
  php: ('abstract and array as break case catch class clone const continue declare default do echo else elseif '
    + 'empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function '
    + 'global if implements include instanceof interface isset list namespace new or print private protected public '
    + 'require return static switch throw trait try unset use var while yield true false null'),
  c: ('auto break case char const continue default do double else enum extern float for goto if int long register '
    + 'return short signed sizeof static struct switch typedef union unsigned void volatile while class public '
    + 'private protected new delete this true false null package import extends implements interface final try catch '
    + 'throw throws string bool func go defer chan map range struct type var fn let mut impl trait pub use mod match '
    + 'loop where self crate async await'),
  css: ''
};
var ALIAS = { javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', node: 'js', json: 'json',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', mysql: 'sql', postgres: 'sql', postgresql: 'sql',
    sqlite: 'sql',
  html: 'html', xml: 'html', svg: 'html', vue: 'html', css: 'css', scss: 'css', less: 'css', php: 'php',
  java: 'c', c: 'c', cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', go: 'c', golang: 'c', rust: 'c', rs: 'c', kotlin: 'c',
    kt: 'c', swift: 'c', dart: 'c' };
var kwSets = {};
function kwSet(lang) {
  if (!kwSets[lang]) { var o = {}; (KW[lang] || '').split(' ').forEach(function (w) { if (w) o[w] = 1; });
    kwSets[lang] = o; }
  return kwSets[lang];
}
function span(cls, text) { return '<span class="tok-' + cls + '">' + esc(text) + '</span>'; }

function highlight(code, lang) {
  var l = ALIAS[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
  if (l === 'html') return highlightHtml(code);
  if (l === 'json') return code.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(true|false|null)\b|([\s\S])/gi, function (m,
    str, colon, num, lit, other) {
    if (str) return span(colon ? 'attr' : 'str', str) + (colon ? esc(colon) : '');
    if (num) return span('num', num); if (lit) return span('kw', lit); return esc(other);
  });
  if (!KW[l] && l !== 'css') return esc(code);
  var ci = l === 'sql', kws = kwSet(l);
  var comment = l === 'python' || l === 'bash' ? '#[^\\n]*' : l === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' :
    l === 'css' ? '\\/\\*[\\s\\S]*?\\*\\/' : l === 'php' ? '\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' :
    '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  var strings = l === 'python'
    ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'' :
    '`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'';
  if (l === 'css') {
    return code.replace(new RegExp('(' + comment + ')|(' + strings
      + (')|(#[0-9a-fA-F]{3,8}\\b|-?\\b\\d+(?:\\.\\d+)?(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?)|([a-zA-Z-]+)(?=\\s*:)|(['
      + '.#]?[a-zA-Z_][\\w-]*)|([\\s\\S])'), 'g'),
      function (m, c, s, n, prop, ident, other) {
        if (c) return span('com', c); if (s) return span('str', s); if (n) return span('num', n); if (prop) return span(
          'attr', prop);
        if (ident) return /^[.#]/.test(ident) ? span('fn', ident) : esc(ident); return esc(other);
      });
  }
  var re = new RegExp('(' + comment + ')|(' + strings
    + ')|(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)|(\\$?[A-Za-z_][\\w]*)(\\s*\\()?|([\\s\\S])', 'g');
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
  return code.replace(new RegExp(
    String.raw`(<!--[\s\S]*?-->)|(<\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|`
    + String.raw`[^\s>]+))?)*)(\s*\/?>)|([\s\S])`, 'g'),
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

function codeBlock(code, lang, open) {
  var label = lang || 'text';
  return '<div class="md-code' + (open ? ' streaming' : '') + '"><div class="md-code-head"><span>' + esc(label)
    + '</span>' +
    '<button type="button" class="md-copy" data-copy-code aria-label="Copy code">Copy</button></div>' +
    '<pre><code class="lang-' + esc(label) + '">' + highlight(code, lang) + '</code></pre></div>';
}

export { codeBlock, highlight };
