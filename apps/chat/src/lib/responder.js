/* Colon AI · on-device PREVIEW responder.
   Used only by the local data adapter while the Colon Saga API (POST /conversations/:id/messages)
   isn't live. It is NOT a language model: it builds honest, mode-aware replies from templates,
   exact arithmetic, and real Wikipedia summaries (which allow cross-origin reads), so every part of
   the chat UI — streaming, Markdown, code, tables, maths, citations — can be exercised end to end.
   The UI labels these replies "Preview".
   Works in the browser (window.ColonResponder) and Node (module.exports) for unit tests. */
// The page's global object in the browser; globalThis under Node (unit tests).
const root = typeof window !== 'undefined' ? window : globalThis;

var STOP = /^(what|whats|what's|who|whos|who's|how|why|when|where|which|is|are|was|were|do|does|did|can|could|should|would|will|please|tell|me|about|explain|describe|define|give|show|teach|help|with|understand|learn|research|find|search|summari[sz]e|compare|the|a|an|of|on|in|for|to|my|i|you|and|or|is|it|its|some|more|topic|subject|important|something|new|difficult|history|meaning|simple|terms|briefly|quick|overview|study|notes)$/i;

// Exact arithmetic: + - * / ^ % ( ) × ÷ and sqrt(). Returns a number, or null if not pure maths.
function evalArithmetic(src) {
  var s = String(src).toLowerCase().replace(/what is|calculate|compute|solve|evaluate|=\s*\??$|\?/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,(?=\d{3})/g, '').trim();
  if (!s || !/^[\d\s+\-*/^%().sqrt]+$/.test(s) || !/\d/.test(s) || !/[+\-*/^%]|sqrt/.test(s)) return null;
  var toks = s.match(/sqrt|\d+(?:\.\d+)?|[+\-*/^%()]/g); if (!toks || toks.join('') !== s.replace(/\s+/g, '')) return null;
  var i = 0;
  function peek() { return toks[i]; }
  function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var op = toks[i++], r = term(); v = op === '+' ? v + r : v - r; } return v; }
  function term() { var v = power(); while (peek() === '*' || peek() === '/' || peek() === '%') { var op = toks[i++], r = power(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; }
  function power() { var b = unary(); if (peek() === '^') { i++; return Math.pow(b, power()); } return b; }
  function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return atom(); }
  function atom() {
    var t = toks[i++];
    if (t === 'sqrt') { if (toks[i++] !== '(') throw 0; var v = expr(); if (toks[i++] !== ')') throw 0; return Math.sqrt(v); }
    if (t === '(') { var w = expr(); if (toks[i++] !== ')') throw 0; return w; }
    if (/^\d/.test(t)) return parseFloat(t);
    throw 0;
  }
  try { var out = expr(); if (i !== toks.length || !isFinite(out)) return null; return Math.round(out * 1e10) / 1e10; } catch (e) { return null; }
}

function topicOf(text) {
  var t = String(text).replace(/https?:\/\/\S+/g, ' ').replace(/[“”"?!.,:;()]/g, ' ').trim();
  var m = /(?:about|on|of|explain|define|research|is|are)\s+(.+)$/i.exec(t);
  var words = (m ? m[1] : t).split(/\s+/).filter(function (w) { return w && !STOP.test(w); });
  return words.slice(0, 5).join(' ');
}

function titleFrom(text) {
  var t = String(text).replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (!t) return 'New chat';
  var w = t.split(' ').slice(0, 7).join(' ');
  w = w.length > 48 ? w.slice(0, 47) + '…' : w;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function intent(text, mode) {
  var s = String(text).toLowerCase();
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|how far|wetin dey|bawo|sannu|kedu)\b/.test(s) && s.length < 40) return 'greet';
  if (evalArithmetic(s) !== null) return 'arith';
  if (/quadratic|equation|solve for|derivative|differentiat|integrat|simultaneous|\bx\^2|\bmaths?\b|algebra|pythagoras|probability/.test(s)) return 'maths';
  if (/website|landing page|web page|html|css/.test(s) && /build|make|create|design/.test(s)) return 'website';
  if (mode === 'developer' || /\b(code|function|bug|error|debug|api|sql|javascript|python|node|react|php|java|regex|script|endpoint|database|query)\b/.test(s)) return 'code';
  if (/\bcompare|versus|\bvs\.?\b|difference between/.test(s)) return 'compare';
  if (mode === 'research' || /research|sources|report on|history of/.test(s)) return 'research';
  if (mode === 'study' || /teach|understand|explain|learn|waec|jamb|neco|exam|revise|revision|quiz/.test(s)) return 'study';
  return 'general';
}

/* ---------- Sources (Wikipedia allows cross-origin reads) ---------- */
function wiki(topic, signal) {
  if (!topic || typeof fetch === 'undefined') return Promise.resolve(null);
  var search = 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=3&namespace=0&search=' + encodeURIComponent(topic);
  return fetch(search, { signal: signal }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    var titles = d && d[1] ? d[1].slice(0, 2) : [];
    return Promise.all(titles.map(function (t) {
      return fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_')), { signal: signal })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }));
  }).then(function (list) {
    list = (list || []).filter(function (x) { return x && x.extract && x.type !== 'disambiguation'; });
    return list.length ? list.map(function (x) { return { title: x.title, url: (x.content_urls && x.content_urls.desktop && x.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title)), snippet: x.extract.slice(0, 600), description: x.description || '' }; }) : null;
  }).catch(function (e) { if (e && e.name === 'AbortError') throw e; return null; });
}
function sentences(text, n) { return (String(text).match(/[^.!?]+[.!?]+(\s|$)/g) || [text]).slice(0, n).map(function (s) { return s.trim(); }); }

var LANG_HELLO = { pcm: 'How far! ', yo: 'Ẹ n lẹ! ', ha: 'Sannu! ', ig: 'Ndewo! ', en: '' };

function codeReply(text) {
  var s = text.toLowerCase();
  if (/sql|query|database|mysql/.test(s)) return 'Here’s a clean MySQL query you can adapt. It totals sales per state for the current month:\n\n```sql\nSELECT s.state,\n       COUNT(o.id)        AS orders,\n       SUM(o.total_naira)  AS revenue_naira\nFROM orders o\nJOIN stores s ON s.id = o.store_id\nWHERE o.created_at >= DATE_FORMAT(CURDATE(), \'%Y-%m-01\')\nGROUP BY s.state\nORDER BY revenue_naira DESC;\n```\n\n**How it works**\n1. `JOIN` links each order to its store’s state.\n2. The `WHERE` clause keeps only this month’s orders.\n3. `GROUP BY` rolls the rows up per state, biggest earners first.\n\nAdd an index on `orders(created_at, store_id)` so it stays fast as the table grows.';
  if (/python/.test(s)) return 'Here’s a small, well-structured Python example: a naira formatter with input checks.\n\n```python\ndef format_naira(amount: float) -> str:\n    """Format a number as Nigerian naira, e.g. ₦1,250,000.00"""\n    if amount < 0:\n        return "-" + format_naira(-amount)\n    return f"₦{amount:,.2f}"\n\n\nif __name__ == "__main__":\n    for value in (1500, 1250000, 99.5):\n        print(format_naira(value))\n```\n\nRun it with `python3 naira.py`. Tell me what you’re building and I’ll tailor it.';
  if (/bug|error|fix|debug/.test(s)) return 'Let’s debug it step by step.\n\n1. **Read the full error**: the first line names the problem, the stack trace shows where.\n2. **Reproduce it** with the smallest input that fails.\n3. **Check the usual suspects**: `undefined` values, wrong types, async code that isn’t awaited.\n\nA common Node.js example and its fix:\n\n```js\n// ❌ Bug: the promise is not awaited, so `user` is a Promise\nconst user = db.findUser(id);\nconsole.log(user.name); // undefined\n\n// ✅ Fix\nconst user = await db.findUser(id);\nconsole.log(user.name);\n```\n\nPaste your code and the exact error, and I’ll point to the line.';
  return 'Here’s a minimal Node.js endpoint to start from (no framework needed):\n\n```js\nimport http from \'node:http\';\n\nconst server = http.createServer(async (req, res) => {\n  if (req.method === \'GET\' && req.url === \'/health\') {\n    res.writeHead(200, { \'Content-Type\': \'application/json\' });\n    return res.end(JSON.stringify({ status: \'ok\' }));\n  }\n  res.writeHead(404).end();\n});\n\nserver.listen(3000, () => console.log(\'Listening on :3000\'));\n```\n\n**Next steps**\n- Add input validation before touching the database.\n- Keep secrets in environment variables, never in code.\n- Return clear error messages with the right status codes.';
}

function websiteReply() {
  return 'Let’s build it together. Here’s a responsive starter page you can save as `index.html` and open in your browser:\n\n```html\n<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My Business</title>\n  <style>\n    body { margin: 0; font-family: system-ui, sans-serif; color: #0F172A; }\n    header { padding: 48px 20px; background: #4169E1; color: #fff; text-align: center; }\n    main { max-width: 860px; margin: 0 auto; padding: 24px 20px; }\n    .btn { display: inline-block; padding: 12px 20px; border-radius: 12px; background: #fff; color: #4169E1; font-weight: 600; text-decoration: none; }\n  </style>\n</head>\n<body>\n  <header>\n    <h1>Fresh foodstuff, delivered in Lagos</h1>\n    <p>Order before 2 pm for same-day delivery.</p>\n    <a class="btn" href="https://wa.me/">Order on WhatsApp</a>\n  </header>\n  <main>\n    <h2>Why customers choose us</h2>\n    <ul>\n      <li>Fair market prices</li>\n      <li>Pay on delivery or by transfer</li>\n    </ul>\n  </main>\n</body>\n</html>\n```\n\n**Plan**\n| Step | What we do |\n|---|---|\n| 1 | Pick your sections (hero, services, prices, contact) |\n| 2 | Add your brand colours and photos |\n| 3 | Make it fast on mobile data |\n| 4 | Publish it on your cPanel hosting |\n\nWhat is the website for? I’ll adapt the copy and layout.';
}

function mathsReply(text) {
  if (/quadratic|x\^2|x²/.test(text.toLowerCase())) return 'For any quadratic equation $ax^2 + bx + c = 0$ (with $a \\neq 0$), the solutions are:\n\n$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\n**Worked example:** solve $x^2 - 5x + 6 = 0$.\n\n1. Identify $a = 1$, $b = -5$, $c = 6$.\n2. Discriminant: $b^2 - 4ac = 25 - 24 = 1$.\n3. So $x = \\frac{5 \\pm 1}{2}$, giving $x = 3$ or $x = 2$.\n\n**Check:** $3^2 - 5(3) + 6 = 0$ ✓\n\n| Discriminant $b^2-4ac$ | Roots |\n|---|---|\n| $> 0$ | two different real roots |\n| $= 0$ | one repeated root |\n| $< 0$ | no real roots |\n\nWant a few WAEC-style questions to practise?';
  if (/pythagoras/.test(text.toLowerCase())) return 'Pythagoras’ theorem: in a right-angled triangle with legs $a$ and $b$ and hypotenuse $c$,\n\n$$a^2 + b^2 = c^2$$\n\n**Example:** legs of 6 m and 8 m give $c = \\sqrt{36 + 64} = \\sqrt{100} = 10$ m.';
  return 'Let’s work through it carefully.\n\n1. Write down what is given and what you need to find.\n2. Choose the rule that links them, for example the power rule $\\frac{d}{dx}x^n = nx^{n-1}$.\n3. Substitute, simplify, then check your answer.\n\n**Example:** $\\frac{d}{dx}(3x^2 + 2x) = 6x + 2$.\n\nSend me the exact question and I’ll solve it step by step.';
}

function practiceQuestions(topic) {
  var t = topic || 'this topic';
  return '\n\n**Practice questions**\n1. In one sentence, what is ' + t + '?\n2. Give one real example of ' + t + ' from Nigeria or Africa.\n3. Why does ' + t + ' matter? List two reasons.\n\n> **Revision tip:** say your answers out loud, then compare them with the notes above.';
}

// Builds the full reply. -> Promise<{ text, sources }>
function respond(input, signal) {
  var text = String(input.content || '').trim(), mode = input.mode || 'general', lang = input.language || 'en';
  var hello = LANG_HELLO[lang] || '';
  var files = input.attachments || [];
  var fileNote = '';
  if (files.length) {
    fileNote = '**Your files**\n' + files.map(function (f) {
      if (f.kind === 'text' && f.excerpt != null) return '- `' + f.name + '`: ' + f.words + ' words, ' + f.lines + ' lines. It begins: “' + f.excerpt.slice(0, 160).replace(/\s+/g, ' ') + (f.excerpt.length > 160 ? '…' : '') + '”';
      if (f.kind === 'image') return '- `' + f.name + '`: image' + (f.width ? ' (' + f.width + '×' + f.height + ' px)' : '') + '. Reading images needs the Colon Saga vision API, which isn’t connected in this preview.';
      if (f.kind === 'audio') return '- `' + f.name + '`: voice note (' + (f.duration ? f.duration + ' s' : 'audio') + '). Transcription arrives with Colon Voice (Phase 6).';
      return '- `' + f.name + '`: ' + (f.kind === 'pdf' ? 'PDF' : 'document') + ' received. Reading its contents needs the Colon Saga API, which isn’t connected in this preview.';
    }).join('\n') + '\n\n';
  }
  if (!text && files.length) return Promise.resolve({ text: fileNote + 'What would you like me to do with ' + (files.length > 1 ? 'these files' : 'this file') + '?', sources: [] });
  var kind = intent(text, mode), topic = topicOf(text);
  if (kind === 'greet') return Promise.resolve({ text: hello + 'Hi! I’m **Colon Saga**. I can explain things step by step, write and fix code, and research topics with sources. What can we explore today?', sources: [] });
  if (kind === 'arith') { var v = evalArithmetic(text); return Promise.resolve({ text: fileNote + 'The answer is **' + v.toLocaleString('en-NG', { maximumFractionDigits: 10 }) + '**.\n\n$$' + text.replace(/[=?]|what is|calculate|compute/gi, '').trim().replace(/\*/g, '\\times ').replace(/\//g, '\\div ') + ' = ' + v + '$$', sources: [] }); }
  if (kind === 'code') return Promise.resolve({ text: fileNote + codeReply(text), sources: [] });
  if (kind === 'website') return Promise.resolve({ text: fileNote + websiteReply(), sources: [] });
  if (kind === 'maths') return Promise.resolve({ text: fileNote + mathsReply(text), sources: [] });

  return wiki(topic, signal).then(function (src) {
    var sources = (src || []).map(function (s, i) { return { n: i + 1, title: s.title, url: s.url, snippet: s.snippet.slice(0, 220) }; });
    var lead = hello + fileNote;
    if (!src) {
      var offline = topic ? 'I couldn’t reach my sources for **' + topic + '** just now, so here’s how I’d approach it:\n\n' : '';
      if (kind === 'study') return { text: lead + offline + '**Let’s learn it step by step**\n1. **Big idea:** what it is, in one sentence.\n2. **Key parts:** the terms you must know.\n3. **Example:** a real case you can picture.\n4. **Check:** answer a few questions.' + practiceQuestions(topic), sources: [] };
      return { text: lead + (offline || 'Tell me a little more and I’ll help. ') + 'You can also pick **Study**, **Developer** or **Research** mode below for a more focused answer.', sources: [] };
    }
    var a = src[0], s1 = sentences(a.snippet, 4);
    if (kind === 'compare' && src[1]) {
      var b = src[1];
      return { text: lead + 'Here’s a quick comparison from my sources:\n\n| | **' + a.title + '** | **' + b.title + '** |\n|---|---|---|\n| What it is | ' + (a.description || sentences(a.snippet, 1)[0]).replace(/\|/g, '/') + ' | ' + (b.description || sentences(b.snippet, 1)[0]).replace(/\|/g, '/') + ' |\n| Key fact | ' + (sentences(a.snippet, 2)[1] || '—').replace(/\|/g, '/') + ' | ' + (sentences(b.snippet, 2)[1] || '—').replace(/\|/g, '/') + ' |\n\n' + a.title + ' [1] and ' + b.title + ' [2] are summarised from Wikipedia. Tell me what you’re deciding and I’ll weigh them for you.', sources: sources };
    }
    if (kind === 'research') {
      return { text: lead + '## ' + a.title + '\n\n' + s1.slice(0, 2).join(' ') + ' [1]\n\n**Key points**\n' + s1.slice(2).concat(src[1] ? sentences(src[1].snippet, 2) : []).map(function (x, i, arr) { return '- ' + x + (src[1] && i >= arr.length - 2 ? ' [2]' : ' [1]'); }).join('\n') +
        '\n\n**Where to dig next**\n1. Primary sources: official reports and statistics (for Nigeria: NBS, CBN).\n2. Recent news coverage for anything that changes quickly.\n3. Academic papers for depth.\n\nWant me to research it step by step in Colon Browser? Tap **Browse the web** below.', sources: sources };
    }
    if (kind === 'study') {
      return { text: lead + '## ' + a.title + ', step by step\n\n**1. The big idea**\n' + s1[0] + ' [1]\n\n**2. Key details**\n' + s1.slice(1).map(function (x) { return '- ' + x; }).join('\n') + ' [1]\n\n**3. Remember it**\nLink it to something you know, then explain it to a friend in your own words.' + practiceQuestions(a.title), sources: sources };
    }
    return { text: lead + s1.slice(0, 3).join(' ') + ' [1]' + (src[1] ? '\n\nRelated: **' + src[1].title + '**: ' + sentences(src[1].snippet, 1)[0] + ' [2]' : '') + '\n\nWant me to go deeper, make it simpler, or turn it into study notes?', sources: sources };
  });
}

// Splits a reply into small chunks for streaming (keeps code fences intact enough to render).
function chunks(text) { return String(text).match(/\s*\S+\s*/g) || []; }

var api = { respond: respond, evalArithmetic: evalArithmetic, topicOf: topicOf, titleFrom: titleFrom, intent: intent, chunks: chunks };
if (typeof window !== 'undefined') window.ColonResponder = api;

export { api as ColonResponder };
