// Talking to Colon while it builds (v0.27.2). A message sent while a build runs never waits: Colon answers it at
// once from the live steps, without touching any file. When the message asks for a change or a new feature, the
// answer starts with "QUEUE:" and the message is built right after the current build (chat.js drains the queue).
const QUEUE = /^\s*QUEUE:\s*/i;

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));
const stepLine = (x) => `- ${x.label}${x.detail ? ` (${x.detail})` : ''}: ${x.state === 'run' ? 'in progress'
  : x.state === 'fail' ? 'failed' : 'done'}`;

// context({ title, request, steps, queued }) -> the system context for the quick answer.
function context({ title, request, steps, queued }) {
  return [
    'You are Colon, building a static website in Colon Workspace. A build is running right now and the user sent',
    'a message in the middle of it. Answer in one or two short, friendly sentences. Never write code or file',
    'contents here, and never claim the build is finished.',
    'If the user asks for any change, addition, fix or new feature for the site (even a small one, or a change to',
    'what is being built now), begin your answer with "QUEUE:" and then say you will do it right after the current',
    'build. If they only ask a question (progress, what you are doing, how long), answer from the steps below and',
    'do not write QUEUE.',
    '',
    `Site: ${clip(title, 80)}`,
    `Building now: ${clip(request, 600)}`,
    'Steps so far:',
    ...(steps.length ? steps.map(stepLine) : ['- Starting']),
    ...(queued.length ? ['Already queued after this build:', ...queued.map((q) => `- ${clip(q, 200)}`)] : []),
  ].join('\n');
}

// parse(text) -> { queue, text }
function parse(text) {
  const raw = String(text || '').trim();
  const queue = QUEUE.test(raw);
  const out = raw.replace(QUEUE, '').trim();
  const fallback = queue ? 'Got it. I’ll do that right after the current build.' : 'Still working on it.';
  return { queue, text: out || fallback };
}

module.exports = { context, parse };
