// Reads Saga's decision out of a model reply (Phase 9). The free models don't share one tool-calling format, so
// Saga answers with one JSON object ({ say, action, args }); this accepts the usual deviations (a ```json fence,
// text around the object, "tool"/"name" for action, "explain"/"thought" for say, a stringified args object).
// parseDecision(text) -> { say, action, args } or throws { code: 'bad_reply' }.

function objects(text) {
  const out = [];
  const s = String(text || '');
  for (let i = s.indexOf('{'); i >= 0 && out.length < 5; i = s.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { out.push(s.slice(i, j + 1)); break; }
    }
  }
  return out;
}

function parseDecision(text) {
  const body = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  for (const raw of objects(body)) {
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    const action = String(o.action || o.tool || o.name || '').trim();
    if (!action) continue;
    let args = o.args !== undefined ? o.args : o.arguments !== undefined ? o.arguments : o.input;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    // finish may be written flat: { "action": "finish", "answer": "…", "sources": [1] }
    if (action === 'finish') {
      if (args.answer === undefined && o.answer !== undefined) args = { ...args, answer: o.answer };
      if (args.sources === undefined && o.sources !== undefined) args = { ...args, sources: o.sources };
    }
    const say = String(o.say || o.explain || o.explanation || o.thought || '').replace(/\s+/g, ' ').trim()
      .slice(0, 300);
    return { say, action: action.slice(0, 40), args };
  }
  throw Object.assign(new Error('The reply had no JSON action.'), { code: 'bad_reply' });
}

module.exports = { parseDecision };
