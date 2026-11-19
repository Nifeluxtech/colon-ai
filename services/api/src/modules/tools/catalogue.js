// Colon's server-side tools (0.17.0, Blueprint D14), registered once in the shared registry. Executors that belong to
// another module call that module's facade, required lazily (search, browser, extract load heavy code, and media /
// research require this module to invoke). A tool whose executor lives with its caller has run: null and the caller
// passes ctx.run (the chat model's browser tools in modules/chat, image generation in modules/media, the deep research
// enqueue in modules/research): the policy still comes from here.
const config = require('../../config');

const str = (description, maxLength, extra = {}) => ({ type: 'string', description, maxLength, ...extra });

function registerAll(reg) {
  // ---- Web: search, Research mode's search-and-read, the page reader ----
  reg.register({ name: 'web_search', risk: 'low', timeoutMs: 20000, guests: false,
    description: 'Search the web and return result titles, links and snippets.',
    schema: { type: 'object', required: ['query'], properties: { query: str('What to search for', 300,
      { minLength: 2 }), limit: { type: 'integer', minimum: 1, maximum: 10 } } },
    note: 'Used by deep research jobs; no charge of its own (the research task is charged).',
    run: (a, ctx) => (ctx.impl || require('../search')).search(a.query, { limit: a.limit, signal: ctx.signal,
      db: ctx.db, fetch: ctx.fetch, cfg: ctx.searchCfg }) });
  reg.register({ name: 'web_research', risk: 'low', timeoutMs: 45000, guests: true,
    description: 'Research mode: search the web for the question and read the top pages before answering.',
    schema: { type: 'object', properties: { text: str('The question', 16000), previous: str('The question before',
      16000), language: str('Reply language', 8) } },
    note: 'Included in the Research reply (BILLING_CREDITS_RESEARCH), so no extra charge here.',
    run: (a, ctx) => (ctx.impl || require('../search')).research({ ...(ctx.options || {}), text: a.text,
      previous: a.previous, language: a.language, signal: ctx.signal }) });
  reg.register({ name: 'read_url', risk: 'low', timeoutMs: 20000, guests: true,
    description: 'Read one web page in light mode (the server reader): title, readable text and links.',
    schema: { type: 'object', required: ['url'], properties: { url: str('An absolute http(s) address', 2048) } },
    enabled: () => require('../browser').reader.enabled(),
    note: 'SSRF-safe reader (robots.txt, private addresses refused). Guests follow BROWSER_READER_GUESTS.',
    run: (a, ctx) => require('../browser').reader.read(a.url, { userId: ctx.user ? ctx.user.id : null,
      cacheKey: ctx.cacheKey }) });
  // ---- Files ----
  reg.register({ name: 'extract_file', risk: 'low', timeoutMs: 30000, guests: true,
    description: 'Read the text out of an uploaded file (PDF, Word, slides, sheets, text, zip projects).',
    schema: { type: 'object', required: ['name'], properties: { name: str('File name', 255) } },
    note: 'The file bytes come with the call (ctx.data); its real type was checked first (extract.validate).',
    run: (a, ctx) => ctx.read(ctx.data, ctx.sniff, a.name) });
  // ---- The chat's browser (Saga): executors in modules/chat/browser-tools.js ----
  reg.register({ name: 'browse', risk: 'high', timeoutMs: 15000, model: true,
    description: 'Do something on the web in this chat\'s own browser (Saga drives it: opens pages, clicks, types, '
      + 'searches, signs in with saved logins, reads results). Use it whenever the user wants anything done or '
      + 'checked on a website or online account, including follow-ups to the last browser task ("go to the repo", '
      + '"open it", "the second one", "check my orders", "in the logged in account"). It continues the same browser '
      + 'session, on the page it is on.',
    schema: { type: 'object', required: ['task'], properties: {
      task: str('The complete task for Saga in plain words, self-contained: resolve "it", "that one", "the repo" and '
        + 'fragments from the conversation and the browser state (name the site, the account, the exact item text '
        + 'and its address when you know them).', 4000),
      item: { type: 'integer', description: 'The number of the clickable item on screen the task is about, when it '
        + 'is one of them (from the browser state\'s numbered list).' },
      url: str('An exact https address to open, when you know it.', 2048) } },
    note: 'Consent happens on the phone: Saga asks before it submits, pays, deletes or sends (ADR 0005). Saga tasks '
      + 'are not charged yet (BILLING_CREDITS_SAGA).' });
  reg.register({ name: 'read_page', risk: 'low', timeoutMs: 15000, model: true,
    description: 'Read the page open in this chat\'s browser now (a short summary and its clickable items), to '
      + 'answer a question about it in the chat. Does not click or change anything.' });
  reg.register({ name: 'stop_browsing', risk: 'low', timeoutMs: 15000, model: true,
    description: 'Stop Saga and close this chat\'s browser (its sign-ins stay for next time). Only when the user '
      + 'asks to stop, close or put away the browser.' });
  // ---- Media (modules/media) ----
  reg.register({ name: 'generate_image', risk: 'medium', model: true, entitlement: 'image_credits', unit: 'images',
    timeoutMs: Math.max(5000, Number(config.media.imageTimeoutMs) || 60000),
    credits: () => config.billing.credits.image,
    enabled: () => Boolean(String(config.media.imageModel || '').trim()),
    description: 'Create a picture from a description (an illustration, a poster idea, a diagram-like drawing), or '
      + 'edit an image: one the user attached to their latest message, or the last image in this chat. Use it when '
      + 'the user asks you to draw, generate, design or make an image, or to change, edit, restyle or add to one.',
    schema: { type: 'object', required: ['prompt'], properties: { prompt: str('What the image should show, in '
      + 'detail (subject, style, colours, text on it). For an edit: exactly what to change and what to keep.', 2000,
    { minLength: 3 }), edit: { type: 'boolean', description: 'true when the user wants an existing image changed '
      + '(the one attached to their latest message, else the last image in this chat), not a new one.' } } },
    note: 'One image credit per image (the plan\'s image_credits), plus BILLING_CREDITS_IMAGE Colon credits. Off '
      + 'while IMAGE_MODEL is empty; needs the Google AI Studio key. Refunded when no image comes back. An edit '
      + '(0.17.1) costs the same as a new image.' });
  // ---- Deep research (modules/research): a background job ----
  reg.register({ name: 'deep_research', risk: 'medium', consent: true, defer: true, entitlement: 'research_tasks',
    unit: 'deep research tasks', timeoutMs: 15000, credits: () => config.billing.credits.deepResearch,
    description: 'Research a question in the background: several searches, many pages read, a cited report posted '
      + 'to the chat when it is done.',
    schema: { type: 'object', required: ['question'], properties: { question: str('The research question', 4000,
      { minLength: 3 }) } },
    note: 'Asks first (it runs for minutes and costs more). Credits are reserved when it starts and settled when the '
      + 'report is posted, or refunded if it fails or is cancelled.' });
  return reg;
}

module.exports = { registerAll };
