// Developer mode (v0.24.0): .gitignore-style rules for project archives and connected repositories. The project's
// root .gitignore (and .colonignore, same syntax, for files the user wants kept out of Colon only) is applied on top
// of the fixed rules in rules.js: matching files are counted as ignored, never listed or read.
// Supported: blank lines and # comments, ! negation, a leading / (anchored to the root), a trailing / (folders
// only), *, ?, [abc] classes and ** (any number of folders). The last matching rule wins.
const MAX_RULES = 500;

function toRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        out += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) { out += '\\['; continue; }
      out += '[' + glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
      i = end;
    } else out += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return out;
}

/** parse(text) -> [{ re, neg, dirOnly }] */
function parse(text) {
  const rules = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (rules.length >= MAX_RULES) break;
    let p = raw.replace(/(?<!\\)\s+$/, '');
    if (!p || p.startsWith('#')) continue;
    const neg = p.startsWith('!');
    if (neg) p = p.slice(1);
    p = p.replace(/^\\([#!])/, '$1');
    const dirOnly = p.endsWith('/');
    p = p.replace(/\/+$/, '');
    if (!p) continue;
    const anchored = p.includes('/');
    p = p.replace(/^\/+/, '');
    const body = toRegex(p);
    rules.push({ re: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`), neg, dirOnly });
  }
  return rules;
}

/** compile(...texts) -> (path) => true when the path is ignored, or null when there are no rules. */
function compile(...texts) {
  const rules = texts.flatMap(parse);
  if (!rules.length) return null;
  return (path) => {
    const parts = String(path).split('/');
    const dirs = parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/'));
    let ignored = false;
    for (const r of rules) {
      const hit = dirs.some((d) => r.re.test(d)) || (!r.dirOnly && r.re.test(path));
      if (hit) ignored = !r.neg;
    }
    return ignored;
  };
}

module.exports = { compile, parse, toRegex };
