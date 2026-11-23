// Workspace chat triage (v0.31.2): which messages need a build, and which Colon can answer in seconds.
// Before 0.31.2 every message ran a whole build (read all files, ask the code model, wait for the full answer), so
// "Open browser" or "hi" sat behind "Thinking and writing the code" for close to a minute.
//   command   opening a tab ("open browser", "show the code"): answered at once, no model call; the app switches tab
//   answer    a greeting, thanks or a question: a short quick answer (quick()); the model may still hand it to a build
//             by starting its answer with "BUILD:"
//   build     everything else, as before. Any doubt means build, so a change request is never lost.
const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

const POLITE = '(?:please\\s+|pls\\s+|can\\s+you\\s+|could\\s+you\\s+|kindly\\s+)?';
const TARGETS = [
  ['open_site', 'browser|live\\s+site|published\\s+site|site\\s+in\\s+(?:the\\s+)?browser'
    + '|website\\s+in\\s+(?:the\\s+)?browser'],
  ['open_preview', 'preview|site|website|page'],
  ['open_code', 'code|files?|editor|ide|terminal|shell|console'],
  ['open_data', 'data|database|db|tables?|secrets?|keys'],
  ['open_publish', 'publish(?:ing)?|domains?|links?'],
  ['open_chat', 'chat'],
];
const COMMANDS = TARGETS.map(([action, words]) => [action, new RegExp(
  `^\\s*${POLITE}(?:open|show|go\\s+to|switch\\s+to|`
  + `view|take\\s+me\\s+to|launch)\\s+(?:me\\s+)?(?:the\\s+|my\\s+)?(?:${words})(?:\\s+(?:tab|page|view|panel))?`
  + '(?:\\s+(?:please|now))?\\s*[.!?]*\\s*$', 'i')]);
const SMALL = new RegExp('^\\s*(?:hi+|hey+|hello+|good\\s+(?:morning|afternoon|evening)|'
  + 'thanks?(?:\\s+you)?|thank\\s+you|ok(?:ay)?|ohkay|cool|nice|great|awesome|'
  + 'perfect|alright|yes|no|wow)\\b[\\s\\w,!.]{0,20}$', 'i');
const ASK = new RegExp('^\\s*(?:what|what\'s|whats|how|why|where|when|who|which|is|are|does|do|did|was|were|explain|'
  + 'tell\\s+me|read|check|look\\s+at|summari[sz]e|review|visit)\\b', 'i');
// a question that asks for a change ("can you add a map?", "how about making it blue?") builds
const CHANGE = new RegExp('\\b(?:add|make|change|create|build|fix|remove|delete|replace|update|edit|move|rename'
  + '|put|insert|turn|set|use|translate|redesign|style|resize|write|generate|connect|deploy|publish\\s+it)\\b', 'i');

const LINES = {
  open_site: 'Opening your site.', open_preview: 'Opening the preview.', open_code: 'Opening the code.',
  open_data: 'Opening your data.', open_publish: 'Opening Publish.', open_chat: 'You’re in the chat.',
};

/** classify(text) -> { kind: 'command', action } | { kind: 'answer' } | { kind: 'build' } (rules only, no model). */
function classify(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 300) return { kind: 'build' };
  for (const [action, re] of COMMANDS) if (re.test(s)) return { kind: 'command', action };
  if (SMALL.test(s) && !CHANGE.test(s)) return { kind: 'answer' };
  if ((s.endsWith('?') || ASK.test(s)) && !CHANGE.test(s)) return { kind: 'answer' };
  return { kind: 'build' };
}

/** The line saved for a command; open_site falls back to the preview when the site isn't published. */
function commandLine(action, published) {
  if (action === 'open_site' && !published) return { action: 'open_preview',
    text: 'Your site isn’t published yet, so I opened the preview.' };
  return { action, text: LINES[action] || 'Done.' };
}

const BUILD = /^\s*BUILD:\s*/i;
/** context({ title, files, recent }) -> the system context for a quick answer. Small: names, sizes, short contents. */
function context({ title, instructions, files, recent, links = [] }) {
  let budget = 12000;
  const bodies = [];
  for (const f of files) {
    if (!f.text || budget <= 0) continue;
    const body = clip(f.content, Math.min(4000, budget));
    budget -= body.length;
    bodies.push(`--- ${f.path} ---\n${body}`);
  }
  return [
    'You are Colon, helping the user with their website in Colon Workspace. Answer the message in one to three',
    'short, friendly sentences. Never write code blocks or file contents, and never say you changed anything.',
    'If the message actually asks you to change, add, fix or build something on the site, reply with exactly',
    '"BUILD:" and nothing else.',
    'The app has tabs: Chat, Preview (eye), Code (files, editor, terminal), Data (database and keys) and Publish',
    '(globe). Point the user to the right tab when it helps.',
    '',
    `Site: ${clip(title, 80)}`,
    ...(instructions ? [`Standing instructions: ${clip(instructions, 400)}`] : []),
    'Files:',
    ...(files.length ? files.map((f) => `- ${f.path} (${Number(f.size) || 0} bytes)`) : ['- none yet']),
    ...(bodies.length ? ['', 'File contents (may be shortened):', ...bodies] : []),
    ...(links.length ? ['', require('./prompt').linksBlock(links)] : []),
    ...(recent.length ? ['', 'Recent messages:', ...recent.map((m) => `${m.role === 'user' ? 'User' : 'Colon'}: `
      + clip(m.content, 300))] : []),
  ].join('\n');
}

/** parse(text) -> { build, text } */
function parse(text) {
  const raw = String(text || '').trim();
  if (!raw || BUILD.test(raw)) return { build: true, text: '' };
  return { build: false, text: raw };
}

// v0.31.2: http(s) links in a message (at most 2), without trailing punctuation.
function links(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!out.includes(u)) out.push(u);
    if (out.length === 2) break;
  }
  return out;
}

module.exports = { links, classify, commandLine, context, parse, COMMANDS };
