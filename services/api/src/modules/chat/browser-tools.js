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
//   ctx: { state, userMsg, messages, generate, toolStream?, routing, now?, repo? }
// v0.24.0: in Developer mode with a connected repository (ctx.repo: { projectId }) the model also gets
// read_repo_file and search_repo (modules/repos, through the registry), answered as function responses so it can
// follow imports over a few rounds before it replies.
const ai = require('../ai');
const tools = require('../tools');
const state = require('./browser-state');
const follow = require('./browse-follow');
const config = require('../../config');
const log = require('../../shared/logger');

// 0.17.0 (D14): the declarations come from the tool registry (modules/tools/catalogue.js), and every call the model
// makes runs through tools.invoke() (plan access, consent, credits, timeout); the executors stay here.
const BROWSER = ['browse', 'read_page', 'stop_browsing'];
const DECLS = tools.declarations(BROWSER);
const REPO = ['read_repo_file', 'search_repo'];
/** This turn's tools: the browser's, plus generate_image while image generation is switched on (IMAGE_MODEL), plus
 * the repository tools when the chat's project has a repository (repo). */
const declsNow = (repo) => tools.declarations([...BROWSER, ...(tools.enabled('generate_image') ? ['generate_image']
  : []), ...(repo ? REPO : [])]);

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
const IMAGE_RULE = '- generate_image when the user asks you to draw, design or create a picture; write a detailed '
  + 'prompt. When the user wants an image changed (one attached to their latest message, or the last image in this '
  + 'chat: "make it brighter", "remove the background", "put me on a beach"), call generate_image with edit: true '
  + 'and a prompt that says exactly what to change and what to keep.';

// 0.17.1: the images an edit starts from (ids for POST /conversations/:id/images attachment_ids). The images on the
// user's latest message always go along (an edit, or a reference to draw from); with edit and none there, the most
// recent image earlier in the chat (an upload or one Colon made).
const EDITABLE = ['image/png', 'image/jpeg', 'image/webp'];
const imagesOf = (m) => ((m && m.attachments) || []).filter((a) => a && a.id && a.kind === 'image'
  && (!a.type || EDITABLE.includes(String(a.type).toLowerCase()))).map((a) => a.id);
function editSources(userMsg, messages, edit) {
  const own = imagesOf(userMsg);
  if (own.length || !edit) return own.slice(0, 3);
  const list = messages || [];
  const end = list.findIndex((m) => userMsg && m.id === userMsg.id);
  for (let i = (end > -1 ? end : list.length) - 1; i >= 0; i--) {
    const ids = imagesOf(list[i]);
    if (ids.length) return ids.slice(-1);
  }
  return [];
}

const REPO_RULE = '- read_repo_file(path) and search_repo(query) read this project\'s connected repository: use them '
  + 'to open files that are not in the project context, follow imports and find definitions before you answer. '
  + 'Never ask the user to paste a file you can open this way.';

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
    name: args.name, web: Boolean(args.web), context: args.context }), RULES.join('\n'),
  tools.enabled('generate_image') ? IMAGE_RULE : '', ctx.repo ? REPO_RULE : '', state.block(s, ctx.guard)]
    .filter(Boolean).join('\n\n') };
  const stream = ctx.toolStream || ai.toolCall.stream;
  const base = { routing: args.routing, tools: declsNow(ctx.repo), signal: args.signal, fetch: args.fetch,
    onDelta: args.onDelta,
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
  const back = [];
  for (let round = 0; round < (ctx.repo ? 6 : 2); round++) {
    const call = r.calls[0];
    if (!call) break;
    const done = await callTool(call, r, s, ctx, args);
    if (done) return { ...r, attempts, ...done, text: done.text != null ? done.text : r.text };
    // read_page / read_repo_file / search_repo: the answers go back as function responses; the model then replies.
    const answers = [];
    for (const c of r.calls) answers.push({ functionResponse: { name: c.name, response: await answerOf(c, ctx, s) } });
    back.push({ role: 'assistant', parts: [...(r.text ? [{ text: r.text }] : []), ...r.calls.map((c) => c.part)] },
      { role: 'user', parts: answers });
    const next = await stream({ ...base, messages: [sys, ...args.messages, ...back] });
    attempts = attempts.concat(next.attempts);
    r = { ...next, text: r.text + next.text };
  }
  return { ...r, attempts };
}

/** A function call the model reads the answer of (read_page, the repository tools). Refusals become { error }. */
async function answerOf(c, ctx, s) {
  if (c.name === 'read_page') return use(ctx, 'read_page', {}, () => readResult(s));
  if (!REPO.includes(c.name) || !ctx.repo) return { error: `There is no function ${String(c.name).slice(0, 40)}.` };
  try {
    const out = (await tools.invoke(c.name, c.args, { user: ctx.user, projectId: ctx.repo.projectId })).result;
    // File text is untrusted: injection patterns are neutralised like any attached file.
    const clean = (v) => (ctx.guard && typeof v === 'string' ? ctx.guard.clean(v, 'file') : v);
    return { ...out, text: clean(out.text), matches: out.matches && out.matches.map((m) => ({ ...m,
      text: clean(m.text) })) };
  } catch (e) {
    if (e.name === 'AbortError' || !e.status || e.status >= 500) throw e;
    return { error: e.message };
  }
}

// One function call through the tool registry. A refusal (plan, consent…) becomes a short line in the chat.
const use = (ctx, name, a, run) => tools.invoke(name, a, { user: ctx.user, run }).then((x) => x.result);

/** -> the turn's ending ({ action, text?, drop }) for browse / stop_browsing / generate_image, or null (read_page). */
async function callTool(call, r, s, ctx, args) {
  const say = (line) => { if (args.onDelta) args.onDelta(line); return { text: r.text + line, drop: false }; };
  try {
    if (call.name === 'browse') {
      const c = call.args || {};
      const a = { task: String(c.task || '').trim().slice(0, 4000) || 'Open it',
        item: Number.isInteger(Number(c.item)) && c.item !== '' && c.item != null ? Number(c.item) : undefined,
        url: typeof c.url === 'string' ? c.url.slice(0, 2048) : undefined };
      const action = await use(ctx, 'browse', a, (clean) => browseAction(goalOf(clean, s), ctx.userMsg, 'tool'));
      return { action, drop: !r.text.trim() };
    }
    if (call.name === 'stop_browsing') {
      const action = await use(ctx, 'stop_browsing', {}, () => ({ event: 'browser', data: { op: 'close',
        message_id: ctx.userMsg.id } }));
      return { action, ...(r.text.trim() ? {} : say('Closed this chat’s browser.')) };
    }
    if (call.name === 'generate_image') {
      // The image itself is made by POST /conversations/:id/images (modules/media), through the registry there:
      // the app gets the prompt and asks for it, so credits are reserved once, by that call.
      const a = tools.validate(tools.registry.get('generate_image').schema, call.args);
      const ids = editSources(ctx.userMsg, ctx.messages, a.edit === true);
      return { action: { event: 'image', data: { prompt: a.prompt, message_id: ctx.userMsg.id,
        ...(ids.length ? { attachment_ids: ids, edit: true } : {}) } }, drop: !r.text.trim() };
    }
    return null;
  } catch (e) {
    if (e.name === 'AbortError' || !e.status || e.status >= 500) throw e;
    log.warn('chat_tool_refused', { tool: call.name, code: e.code });
    return { ...say((r.text ? '\n\n' : '') + e.message), action: undefined };
  }
}

module.exports = { turn, goalOf, fallback, readResult, editSources, answerOf, DECLS, RULES, REPO_RULE, BROWSE_SAY,
  declsNow };
