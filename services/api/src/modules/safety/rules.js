// The rule engine behind the input and output filters. A category file (data/*.js) lists rules:
//   { id, all: [[fragment…], [fragment…]], window?, unless?: [fragment…], unlessAction?, action, care?, prefix? }
// A rule fires when every group in `all` matches within `window` characters (default 160) of the first group's
// match, so an essay that says "how to make" in one paragraph and "bomb" five paragraphs later does not fire.
// `unless` (benign context: news, prevention, health…) within 300 characters turns the action into
// `unlessAction` ('allow' by default, i.e. the rule is skipped). Text is folded first (normalize.js).
const { fold, foldPattern } = require('./normalize');

const RANK = { allow: 0, allow_with_care: 1, refuse: 2 };
const DEFAULT_WINDOW = 160;
const UNLESS_WINDOW = 300;

const compile = (frags) => new RegExp(frags.map(foldPattern).map((f) => `(?:${f})`).join('|'), 'g');

function compileCategory(def) {
  return {
    category: def.category,
    rules: def.rules.map((r) => ({
      ...r,
      groups: r.all.map(compile),
      unlessRe: r.unless && r.unless.length ? compile(r.unless) : null,
      window: r.window || DEFAULT_WINDOW,
    })),
  };
}

function positions(re, text) {
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(text)) && out.length < 50) {
    out.push(m.index);
    if (m[0] === '') re.lastIndex++;
  }
  return out;
}

const near = (re, text, at, span) => {
  const from = Math.max(0, at - span);
  re.lastIndex = 0;
  return re.test(text.slice(from, at + span));
};

// -> { at } of the first place every group matches together, or null.
function matchRule(rule, text) {
  for (const at of positions(rule.groups[0], text)) {
    if (rule.groups.slice(1).every((g) => near(g, text, at, rule.window))) return { at };
  }
  return null;
}

// Runs one compiled category over folded text. -> { category, rule, action, care, prefix } or null.
function runCategory(cat, folded) {
  let best = null;
  for (const rule of cat.rules) {
    const m = matchRule(rule, folded);
    if (!m) continue;
    let action = rule.action;
    let care = rule.care || null;
    if (rule.unlessRe && near(rule.unlessRe, folded, m.at, UNLESS_WINDOW)) {
      action = rule.unlessAction || 'allow';
      care = rule.unlessCare || care;
    }
    if (action === 'allow') continue;
    const hit = { category: cat.category, rule: rule.id, action, care, prefix: rule.prefix || null };
    if (!best || RANK[hit.action] > RANK[best.action]) best = hit;
    if (best.action === 'refuse') break;
  }
  return best;
}

// The stronger of two decisions (refuse > allow_with_care > allow); ties keep the first.
const stronger = (a, b) => (!a ? b : !b ? a : RANK[b.action] > RANK[a.action] ? b : a);

module.exports = { compileCategory, runCategory, matchRule, stronger, fold, RANK };
