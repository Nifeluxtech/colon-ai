// Saga's controlled tool set (Phase 9). The model may only pick one of these by name; its arguments are rebuilt
// here from a per-tool allow-list (anything else, including any attempt to pre-approve an action, is dropped), and
// each tool maps to exactly one bridge command the phone knows (docs/android-bridge.md, "Commands").
// toCommand(action, args, ctx) -> { tool, name, args, tabId } or throws { code: 'bad_action', message }.
const MAX_URL = 2048;
const MAX_VALUE = 500;
const EL_ID = /^c\d{1,4}$/;
const TAB_ID = /^[\w.:-]{1,40}$/;

const bad = (message) => Object.assign(new Error(message), { code: 'bad_action' });

// http(s) only, no credentials in the URL, at most 2048 characters.
function webUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > MAX_URL) throw bad('openUrl needs an http(s) URL of at most 2048 characters.');
  let u;
  try { u = new URL(s); } catch { throw bad('That is not a valid URL.'); }
  if (!/^https?:$/.test(u.protocol)) throw bad('Only http and https pages can be opened.');
  if (u.username || u.password) throw bad('URLs with a user name or password are not allowed.');
  return u.toString();
}

function elementId(v, ctx) {
  const id = String(v == null ? '' : v);
  if (!EL_ID.test(id)) throw bad('Use an element id from the last getPageContent (like c12).');
  if (ctx && ctx.elements && !ctx.elements.has(id)) {
    throw bad(`Element ${id} is not on the last page you read. Call getPageContent first.`);
  }
  return id;
}

const text = (v, n = MAX_VALUE) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').slice(0, n);

const TOOLS = {
  openUrl: { doc: 'openUrl {"url": "https://...", "newTab": false} - open a page',
    build: (a) => ({ name: 'open_url', args: { url: webUrl(a.url),
      ...(a.newTab === true ? { new_tab: true } : {}) } }) },
  getPageContent: { doc: 'getPageContent {} - read the current page: title, URL, text and numbered elements (c1, c2…)',
    build: () => ({ name: 'get_page_content', args: {} }) },
  getLinks: { doc: 'getLinks {} - list the links on the current page',
    build: () => ({ name: 'get_links', args: {} }) },
  click: { doc: 'click {"id": "c12"} - click an element from the last getPageContent',
    build: (a, ctx) => ({ name: 'click', args: { id: elementId(a.id, ctx) } }) },
  fill: { doc: 'fill {"id": "c3", "value": "text", "submit": false} - type into a field (submit presses Enter)',
    build: (a, ctx) => ({ name: 'fill', args: { id: elementId(a.id, ctx), value: text(a.value),
      ...(a.submit === true ? { submit: true } : {}) } }) },
  scroll: { doc: 'scroll {"direction": "down"} - up, down, top or bottom',
    build: (a) => {
      const d = String(a.direction || 'down');
      if (!['up', 'down', 'top', 'bottom'].includes(d)) throw bad('scroll direction is up, down, top or bottom.');
      return { name: 'scroll', args: { direction: d } };
    } },
  screenshot: { doc: 'screenshot {} - a small picture of the visible page (only useful for image-reading models)',
    build: () => ({ name: 'screenshot', args: {} }) },
  back: { doc: 'back {} - go back', build: () => ({ name: 'back', args: {} }) },
  forward: { doc: 'forward {} - go forward', build: () => ({ name: 'forward', args: {} }) },
  refresh: { doc: 'refresh {} - reload the page', build: () => ({ name: 'reload', args: {} }) },
  tabs: { doc: 'tabs {"action": "list"} - list, or {"action": "switch"|"close", "tabId": "…"}, or '
    + '{"action": "new", "url": "https://..."}',
  build: (a) => {
    const act = String(a.action || 'list');
    if (act === 'list') return { name: 'get_tabs', args: {} };
    if (act === 'new') return { name: 'new_tab', args: a.url ? { url: webUrl(a.url) } : {} };
    if (act === 'switch' || act === 'close') {
      const id = String(a.tabId || a.tab_id || '');
      if (!TAB_ID.test(id)) throw bad('tabs switch/close needs a tabId from tabs list.');
      return { name: act === 'switch' ? 'switch_tab' : 'close_tab', args: { tab_id: id } };
    }
    throw bad('tabs action is list, new, switch or close.');
  } },
  // 0.10.3: the browser is AI-only; this is how Saga hands it to the user for what only they can do (the loop runs
  // it: the phone shows "Saga needs you" with Take control, and Saga continues when the user gives it back).
  requestUserControl: { doc: 'requestUserControl {"reason": "sign_in|one_time_code|captcha|payment|consent|other", '
    + '"instructions": "one short sentence: what the user should do in the browser"} - hand the browser to the user '
    + 'for something only they can do; you continue when they give it back', build: null },
  finish: { doc: 'finish {"answer": "…", "result": "a few words for the status line, like Deployed Colon AI '
    + 'v0.10.2", "sources": [1, 2]} - stop and answer; sources are page numbers you read', build: null },
};
// Names some models write for the same tool.
const ALIASES = { request_user_control: 'requestUserControl', requestUser: 'requestUserControl' };
const canonical = (action) => ALIASES[action] || action;

// requestUserControl's arguments, rebuilt: { kind, message, reason }. The message is shown to the user as is.
const USER_REASONS = ['sign_in', 'one_time_code', 'captcha', 'payment', 'consent', 'other'];
const USER_DEFAULT = { sign_in: 'Sign in here, then tell me in the chat.', one_time_code: 'Enter the code you got, '
  + 'then tell me in the chat.', captcha: 'Solve the check on the page, then tell me in the chat.', payment: 'Review '
  + 'and complete the payment yourself, then tell me in the chat.', consent: 'Make this choice on the page, then tell '
  + 'me in the chat.', other: 'Please do this step yourself, then tell me in the chat.' };
function userRequest(args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const reason = USER_REASONS.includes(a.reason) ? a.reason : 'other';
  const said = text(a.instructions || a.message || '', 200).replace(/\s+/g, ' ').trim();
  return { kind: reason, reason: `Saga asked: ${reason}`, message: said || USER_DEFAULT[reason] };
}
const NAMES = Object.keys(TOOLS);
const COMMANDS = ['open_url', 'get_page_content', 'get_links', 'click', 'fill', 'scroll', 'screenshot', 'back',
  'forward', 'reload', 'get_tabs', 'new_tab', 'switch_tab', 'close_tab'];
// Commands that change the page the user sees (the next getPageContent re-numbers elements).
const NAVIGATES = new Set(['open_url', 'click', 'back', 'forward', 'reload', 'new_tab', 'switch_tab', 'close_tab']);

function toCommand(action, args, ctx = {}) {
  action = canonical(action);
  const tool = TOOLS[action];
  if (!tool || !tool.build) {
    throw bad(`Unknown tool "${String(action).slice(0, 40)}". Use one of: ${NAMES.join(', ')}.`);
  }
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const out = tool.build(a, ctx);
  return { tool: action, name: out.name, args: out.args };
}

module.exports = { TOOLS, NAMES, COMMANDS, NAVIGATES, toCommand, webUrl, EL_ID, canonical, userRequest,
  USER_REASONS };
