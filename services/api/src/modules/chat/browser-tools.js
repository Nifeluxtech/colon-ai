// 0.11.5 (owner): one model, with the browser as a tool. Browser follow-ups ("go to Colon repo", "open it", "click
// the second one", "check my orders") used to be routed by keywords (browse-follow.js, the app's browser-intent.js)
// and often reached plain chat. Now the chat model itself decides on every turn, in every specialist mode (the mode
// never changes), with three Gemini function declarations:
//   browse(task, item?, url?)  Saga starts or continues the task in this chat's browser session (live card under
//                              the user's message; the app runs it on event `browse`)
//   read_page()                a short summary of the current page (the model then answers in the chat)
//   stop_browsing()            closes this chat's browser (or hands it back); event `browser {op: 'close'}`
// The browser state (browser-state.js) is in the system prompt whenever the chat has a session. When the tool
// models fail (no key, quota, errors before any text), the old keyword routing decides (browse-follow.js), and an
// ordinary reply comes from the usual chain (generate.js, AI_MODEL_SET): nothing is worse than 0.11.4.
//   turn(args, ctx) -> generate()-shaped result, plus .action { event, data } and .drop (no chat text to keep)
//   ctx: { state, userMsg, messages, generate, toolStream?, routing, now? }
const ai = require('../ai');
const state = require('./browser-state');
const follow = require('./browse-follow');
const config = require('../../config');
const log = require('../../shared/logger');

const DECLS = [
  { name: 'browse', description: 'Do something on the web in this chat\'s own browser (Saga drives it: opens pages, '
    + 'clicks, types, searches, signs in with saved logins, reads results). Use it whenever the user wants anything '
    + 'done or checked on a website or online account, including follow-ups to the last browser task ("go to the '
    + 'repo", "open it", "the second one", "check my orders", "in the logged in account"). It continues the same '
    + 'browser session, on the page it is on.',
  parameters: { type: 'object', required: ['task'], properties: {
    task: { type: 'string', description: 'The complete task for Saga in plain words, self-contained: resolve "it", '
      + '"that one", "the repo" and fragments from the conversation and the browser state (name the site, the '
      + 'account, the exact item text and its address when you know them).' },
    item: { type: 'integer', description: 'The number of the clickable item on screen the task is about, when it is '
      + 'one of them (from the browser state\'s numbered list).' },
    url: { type: 'string', description: 'An exact https address to open, when you know it.' } } } },
  { name: 'read_page', description: 'Read the page open in this chat\'s browser now (a short summary and its '
    + 'clickable items), to answer a question about it in the chat. Does not click or change anything.',
  parameters: { type: 'object', properties: {} } },
  { name: 'stop_browsing', description: 'Stop Saga and close this chat\'s browser (its sign-ins stay for next time). '
    + 'Only when the user asks to stop, close or put away the browser.',
  parameters: { type: 'object', properties: {} } },
];

const RULES = [
  'Browser tools: you can use this chat\'s own web browser through the functions browse, read_page and '
    + 'stop_browsing. Your mode, role and rules stay the same; the browser is just a tool you may use.',
  '- Call browse when the user wants something done or looked up on a website, an online account or the live web '
    + '(open, go to, click, search, sign in, check, find, buy, compare, fill in), and for follow-ups to the last '
    + 'browser task, including short ones ("open it", "the second one", "go to Colon repo", "check my tasks") and '
    + 'fragments without a verb ("in the logged in account": continue the last task with it).',
  '- Write browse\'s task self-contained: name the site and the exact thing (for "the repo" after signing in to a '
    + 'code host as someone, the owner/name address; for "the second one", item 2\'s text and address).',
  '- Never tell the user to tap, click or open something in the browser themselves, never ask them for a link you '
    + 'can find, and never write out browsing steps as text: call browse instead.',
  '- Do not call a function for questions you can answer yourself (explaining code, writing, general knowledge, '
    + 'questions about the conversation); answer in the chat.',
  '- read_page only when the user asks about what the page shows and the state below does not already answer it.',
];

const BROWSE_SAY = 'On it in this chat’s browser.';

/** The goal Saga gets: the model's task, made exact with the clickable item or address it named. */
function goalOf(args, s) {
  const task = String(args.task || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const it = state.item(s, args.item);
  const url = /^https?:\/\//i.test(String(args.url || '')) ? String(args.url).slice(0, 600) : '';
  const extra = [it ? `item ${it.n} on the page: "${it.text}"${it.href ? ` -> ${it.href}` : ''}` : '',
    url && !task.includes(url) ? `address: ${url}` : ''].filter(Boolean).join('; ');
  return (extra ? `${task || 'Open it'} (${extra})` : task).slice(0, 1000);
}

function readResult(s) {
  if (!s || (!s.url && !s.summary)) return { page: 'No page is open in this chat\'s browser.' };
  return { url: s.url, title: s.title, summary: s.summary || '(the page could not be read)',
    items: s.items.map((x) => `[${x.n}] ${x.text}${x.href ? ` -> ${x.href}` : ''}`).join('\n') };
}

const browseAction = (goal, userMsg, how) => ({ event: 'browse', data: { goal, message_id: userMsg.id, how } });

/** The old keyword routing, kept only as the fallback when the tool models fail. */
function fallback(ctx, attempts = []) {
  const goal = follow.route(ctx.userMsg, ctx.messages, ctx.now, Boolean(ctx.state));
  return goal ? { text: '', action: browseAction(goal, ctx.userMsg, 'keywords'), drop: true, attempts } : null;
}

async function turn(args, ctx) {
  const s = ctx.state || null;
  const sys = { role: 'system', content: [ai.prompts.systemPrompt({ mode: args.mode, language: args.language,
    name: args.name, web: Boolean(args.web), context: args.context }), RULES.join('\n'), state.block(s, ctx.guard)]
    .filter(Boolean).join('\n\n') };
  const stream = ctx.toolStream || ai.toolCall.stream;
  const base = { routing: args.routing, tools: DECLS, signal: args.signal, fetch: args.fetch, onDelta: args.onDelta,
    timeouts: { ...config.chat, ...(args.mode === 'developer' && config.chat.developerMaxTokens
      ? { maxTokens: config.chat.developerMaxTokens } : {}), ...(args.timeouts || {}) } };
  let r;
  try {
    r = await stream({ ...base, messages: [sys, ...args.messages] });
  } catch (e) {
    if (e.name === 'AbortError' || e.partial || e.code !== 'tools_failed') throw e;
    log.warn('chat_tools_fallback', { code: e.code });
    const kept = fallback(ctx, e.attempts || []);
    if (kept) return kept;
    const g = await ctx.generate(args);
    return { ...g, attempts: (e.attempts || []).concat(g.attempts || []) };
  }
  let attempts = r.attempts;
  for (let round = 0; round < 2; round++) {
    const call = r.calls[0];
    if (!call) break;
    if (call.name === 'browse') {
      return { ...r, attempts, action: browseAction(goalOf(call.args, s), ctx.userMsg, 'tool'),
        text: r.text, drop: !r.text.trim() };
    }
    if (call.name === 'stop_browsing') {
      const said = r.text.trim() ? '' : 'Closed this chat’s browser.';
      if (said && args.onDelta) args.onDelta(said);
      return { ...r, attempts, action: { event: 'browser', data: { op: 'close', message_id: ctx.userMsg.id } },
        text: r.text + said };
    }
    // read_page: the summary goes back as the function's answer; the model then replies (or browses).
    const back = [{ role: 'assistant', parts: [...(r.text ? [{ text: r.text }] : []), ...r.calls.map((c) => c.part)] },
      { role: 'user', parts: [{ functionResponse: { name: 'read_page', response: readResult(s) } }] }];
    const next = await stream({ ...base, messages: [sys, ...args.messages, ...back] });
    attempts = attempts.concat(next.attempts);
    r = { ...next, text: r.text + next.text };
  }
  return { ...r, attempts };
}

module.exports = { turn, goalOf, fallback, readResult, DECLS, RULES, BROWSE_SAY };
