// Task classifier for specialist routing (Phase 5, v0.5.10). Rule-based and cheap: no model call, a few regexes
// over the last user message. It answers two things:
//   language  'pcm' | 'yo' | 'ha' | 'ig' | 'en'  the reply language (an African setting wins; otherwise the
//             existing detector in prompts.js reads the message, the same one replyLanguage() uses)
//   task      'code' | 'reasoning' | 'exam' | 'research' | 'everyday'
// and the routing category: the African language when there is one (the weakest spot of most models), else the task.
const AFRICAN = ['pcm', 'yo', 'ha', 'ig'];
const LANG_CATEGORY = { pcm: 'pidgin', yo: 'yoruba', ha: 'hausa', ig: 'igbo' };

const { detectLanguage } = require('./prompts');

const CODE_FILE = new RegExp('\\.(js|mjs|cjs|ts|tsx|jsx|py|java|kt|go|rs|rb|php|c|cc|cpp|h|hpp|cs|swift|sql|sh|'
  + 'ps1|html|css|scss|json|ya?ml|toml|vue|svelte|dart|lua|r|ipynb)$', 'i');
const CODE_TEXT = new RegExp([
  '```', '\\b(function|const|let|var|def|class|import|return|async|await|public static|#include)\\b\\s*[\\w({]',
  '\\b(stack ?trace|traceback|exception|syntax ?error|typeerror|undefined is not|null pointer|segfault|compile)\\b',
  '\\b(debug|refactor|regex|api endpoint|npm|pip install|git |docker|sql query|javascript|typescript|python|java\\b|'
    + 'php|react|node\\.?js|html|css|kotlin|flutter|laravel|django)',
  '\\b(write|fix|build) (me )?(a |an |the |this )?(code|script|function|program|app|website|bug)',
  '[{};]\\s*\\n.*[{};]',
].join('|'), 'i');
const MATH_TEXT = new RegExp([
  '\\b(solve|calculate|compute|evaluate|simplify|differentiate|integrate|prove|factori[sz]e|probability|equation|'
    + 'derivative|integral|logarithm|quadratic|percentage|ratio|how many|what is the value)\\b',
  '\\d\\s*[-+*/×÷^=]\\s*\\d', '\\b[a-z]\\s*[=<>]\\s*-?\\d', '\\b(sin|cos|tan|log|sqrt)\\s*\\(',
  '\\b(riddle|puzzle|logic|deduce|if .* then .* which)\\b',
].join('|'), 'i');
const EXAM_TEXT = new RegExp([
  '\\b(waec|neco|jamb|utme|wassce|ssce|gce|post[- ]?utme|past questions?|objectives?|theory questions?|exam|'
    + 'examination|syllabus|cbt|mock test|revision|course ?code|lecture notes?|semester|gst \\d|mth ?\\d|'
    + 'chm ?\\d|phy ?\\d|bio ?\\d|undergraduate|university|polytechnic)\\b',
  '\\b(explain|define|state|list|outline|describe|differentiate between)\\b.*\\b(marks?|candidates?|students?)\\b',
  '(^|\\n)\\s*[a-d][.)]\\s+\\S.*\\n\\s*[a-d][.)]\\s+\\S',
].join('|'), 'i');
const RESEARCH_TEXT = new RegExp([
  '\\b(search|look up|find (me )?(sources|articles|links)|latest|news|today|this week|current|recent|update on|'
    + 'price of|exchange rate|weather|who won|cite|citations?|sources?|according to)\\b',
].join('|'), 'i');

const CATEGORIES = ['code', 'reasoning', 'exam', 'research', 'everyday', 'pidgin', 'yoruba', 'hausa', 'igbo'];

function lastUserText(messages) {
  const m = [...(messages || [])].reverse().find(x => x && x.role === 'user');
  if (!m) return '';
  if (Array.isArray(m.content)) return m.content.filter(p => p && p.type === 'text').map(p => p.text).join('\n');
  return String(m.content || '');
}

/**
 * classify({ mode, language, messages?, text?, attachments?, web? }) -> { language, task, category, signals }
 *   language     the user's reply-language setting (users.language); an African setting always wins
 *   attachments  file names (or { name }) sent with the message; code files mean a code task
 *   web          Research mode searched the web for this reply
 */
function classify({ mode = 'general', language = 'en', messages = null, text = null, attachments = [],
  web = false } = {}) {
  const body = text != null ? String(text) : lastUserText(messages);
  const signals = [];
  let lang = AFRICAN.includes(language) ? language : null;
  if (lang) signals.push('setting');
  else {
    // Fenced code says nothing about the language the person writes in.
    lang = detectLanguage(body.replace(/```[\s\S]*?(```|$)/g, ' ')) || 'en';
    if (lang !== 'en') signals.push('text');
  }
  const names = (attachments || []).map(a => (a && typeof a === 'object' ? a.name : a)).filter(Boolean).map(String);
  let task;
  if (mode === 'developer' || names.some(n => CODE_FILE.test(n)) || CODE_TEXT.test(body)) task = 'code';
  else if (mode === 'research' || web || RESEARCH_TEXT.test(body) && !MATH_TEXT.test(body)) task = 'research';
  else if (mode === 'study' || EXAM_TEXT.test(body)) task = 'exam';
  else if (MATH_TEXT.test(body)) task = 'reasoning';
  else task = 'everyday';
  signals.push(`task:${task}`);
  const category = lang !== 'en' ? LANG_CATEGORY[lang] : task;
  return { language: lang, task, category, signals };
}

module.exports = { classify, lastUserText, CATEGORIES, LANG_CATEGORY, AFRICAN };
