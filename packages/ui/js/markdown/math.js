/* ColonMarkdown · TeX-style math ($...$, $$...$$) rendered to HTML without a library. */

import { esc, root } from './escape.js';

/* ---------- Maths (TeX subset) ---------- */
var SYM = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
    vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠',
    approx: '≈', equiv: '≡', sim: '∼', cong: '≅', propto: '∝',
  infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
    Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', mapsto: '↦',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', partial: '∂', nabla: '∇', in: '∈', notin: '∉', ni: '∋',
    subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨', circ: '∘', degree: '°', angle: '∠',
    perp: '⊥', parallel: '∥', therefore: '∴', because: '∵',
  ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', prime: '′', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
    aleph: 'ℵ', star: '⋆', bullet: '•', triangle: '△', square: '□',
  langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', mid: '∣', vert: '|', Vert: '‖',
    quad: '\u2003', qquad: '\u2003\u2003',
  '{': '{', '}': '}', '%': '%', '$': '$', '&': '&', '#': '#', '_': '_', '|': '‖'
};
var OPS = { sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, arcsin: 1, arccos: 1, arctan: 1, sinh: 1, cosh: 1, tanh: 1,
  log: 1, ln: 1, lg: 1, exp: 1, lim: 1, max: 1, min: 1, sup: 1, inf: 1, det: 1, gcd: 1, deg: 1, dim: 1, mod: 1,
  arg: 1 };

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
      case 'frac': case 'dfrac': case 'tfrac': { var a = arg(), b = arg();
        return '<span class="m-frac"><span class="m-num">' + a + '</span><span class="m-den">' + b + '</span></span>'; }
      case 'sqrt': {
        var idx = ''; skipWs();
        if (s[i] === '[') { var end = s.indexOf(']', i); idx = '<sup class="m-idx">' + esc(s.slice(i + 1,
          end)) + '</sup>'; i = end + 1; }
        return '<span class="m-sqrt">' + idx + '√<span class="m-rad">' + arg() + '</span></span>';
      }
      case 'text': case 'textrm': case 'mathrm': case 'operatorname': case 'textit': return '<span class="m-text">'
        + rawGroup() + '</span>';
      case 'mathbf': case 'textbf': case 'boldsymbol': return '<b>' + arg() + '</b>';
      case 'mathit': return '<i>' + arg() + '</i>';
      case 'overline': case 'bar': return '<span class="m-over">' + arg() + '</span>';
      case 'vec': return '<span class="m-vec">' + arg() + '</span>';
      case 'hat': return arg() + '\u0302';
      case 'left': case 'right': case 'big': case 'Big': case 'bigg': case 'Bigg': { skipWs(); if (s[i] === '.') { i++;
        return ''; } if (s[i] === '\\') { i++; return command(readName()); } return esc(s[i++] || ''); }
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
    try { return k.renderToString(src, { displayMode: !!display, throwOnError: false, output: 'html' });
      } catch (e) { /* fall through */ }
  }
  var body = tex(src);
  return display ? '<div class="math-block" role="math" aria-label="' + esc(src) + '">' + body + '</div>'
    : '<span class="math" role="math" aria-label="' + esc(src) + '">' + body + '</span>';
}

export { math, tex };
