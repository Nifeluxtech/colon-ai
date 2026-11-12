// The rule-based classifier: one folding pass, then each enabled category's rules (data/*.js).
// classify(text, { enabled, audience }) -> decision
//   { action: 'allow' | 'allow_with_care' | 'refuse', category, rule, care: [keys], prefix: [keys], hits: [...] }
// Cost: a few dozen regular expressions over at most 20,000 characters; no model, no network, no state.
const { compileCategory, runCategory, fold, RANK } = require('./rules');
const { redact } = require('./redact');
const policy = require('./policy');

const DATA = ['csam', 'self-harm', 'violence', 'drugs', 'hate', 'sexual', 'fraud', 'privacy']
  .map((f) => require(`./data/${f}`));
const INPUT = DATA.map(compileCategory);
const OUTPUT = DATA.filter((d) => d.output && d.output.length)
  .map((d) => compileCategory({ category: d.category, rules: d.output }));

const ALLOW = Object.freeze({ action: 'allow', category: null, rule: null, care: [], prefix: [], hits: [] });

function decide(hits) {
  if (!hits.length) return { ...ALLOW, hits: [] };
  const top = hits.reduce((a, b) => (RANK[b.action] > RANK[a.action] ? b : a));
  return {
    action: top.action, category: top.category, rule: top.rule,
    care: top.action === 'allow_with_care' ? [...new Set(hits.filter((h) => h.action === 'allow_with_care')
      .map((h) => h.care).filter(Boolean))] : [],
    prefix: top.action === 'allow_with_care' ? [...new Set(hits.map((h) => h.prefix).filter(Boolean))] : [],
    hits,
  };
}

function classify(text, { enabled = null, audience = 'user' } = {}) {
  const folded = fold(text);
  if (!folded) return { ...ALLOW, hits: [] };
  const hits = [];
  for (const cat of INPUT) {
    if (enabled && !enabled[cat.category]) continue;
    const hit = policy.adjust(runCategory(cat, folded), audience);
    if (!hit) continue;
    hits.push(hit);
    if (hit.action === 'refuse' && cat.category === 'csam') break;  // nothing else matters
  }
  // A pasted card number (checked with Luhn, not a pattern) is the user's own secret too.
  if ((!enabled || enabled.privacy) && !hits.some((h) => h.rule === 'own_secret') && redact(text).count) {
    hits.push({ category: 'privacy', rule: 'own_secret', action: 'allow_with_care', care: 'own_data', prefix: null });
  }
  return decide(hits);
}

// Output check for the hard-block categories (csam, violence, drugs): used on the streamed reply.
function classifyOutput(text, { enabled = null } = {}) {
  const folded = fold(text);
  for (const cat of OUTPUT) {
    if (enabled && !enabled[cat.category]) continue;
    const hit = runCategory(cat, folded);
    if (hit && hit.action === 'refuse') return hit;
  }
  return null;
}

module.exports = { classify, classifyOutput, decide, ALLOW };
