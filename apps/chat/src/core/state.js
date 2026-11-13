/* Colon AI · workspace state shared by the chat modules: the S object, the active data adapter, modes,
   prompts and small lookups. `data` is set once per mount through setData(). */

import { CW } from './cw.js';
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

var data = null;  // picked in mount(): your account, a guest chat, or the offline Preview (core/data.js)
// The one place `data` changes (ES module imports are read-only views of it).
function setData(d) { data = d; }

var MODES = {
  general: { label: 'General', sub: 'General Assistant', icon: 'sparkle', hint: 'Ask Colon anything…' },
  study: { label: 'Study', sub: 'Study Mode', icon: 'book', hint: 'Ask a study question…' },
  developer: { label: 'Developer', sub: 'Developer Mode', icon: 'code', hint: 'Describe code or paste an error…' },
  research: { label: 'Research', sub: 'Research Mode', icon: 'search',
    hint: 'What should I research? I’ll search the web…' }
};
var PROMPTS = [
  { icon: 'cap', title: 'Learn something new', text: 'Help me understand a difficult topic',
    prompt: 'Help me understand photosynthesis step by step', mode: 'study' },
  { icon: 'code', title: 'Build a website', text: 'Build a website with me',
    prompt: 'Build a website with me for my small food business in Lagos', mode: 'developer' },
  { icon: 'search', title: 'Research a topic', text: 'Research an important subject',
    prompt: 'Research the history of Lagos and its economy', mode: 'research' },
  { icon: 'bulb', title: 'Get help with code', text: 'Debug, explain or write code',
    prompt: 'Help me fix a bug in my Node.js code', mode: 'developer' }
];
// Developer mode quick actions: each chip fills the composer with a short template (the cursor lands at `|`).
var DEV_ACTIONS = [
  { key: 'explain', label: 'Explain', icon: 'bulb',
    text: 'Explain this code step by step: what it does, its complexity and any pitfalls.\n\n|' },
  { key: 'fix', label: 'Fix a bug', icon: 'code',
    text: 'Fix this bug.\nWhat I expected: |\nWhat happens instead (error message): \nCode:\n' },
  { key: 'generate', label: 'Generate', icon: 'sparkle',
    text: 'Write complete, runnable code for: |\nLanguage / framework: \nWhere it will run: ' },
  { key: 'review', label: 'Review', icon: 'search',
    text: 'Review this code for bugs, security and readability, and suggest improvements.\n\n|' }
];
var CAPS = { text: 'Text', reasoning: 'Reasoning', code: 'Code', vision: 'Images', web: 'Web', citations: 'Citations',
  voice: 'Voice' };

var S = {
  el: null, models: [], settings: null, convs: [], q: '', current: null, messages: [], streaming: null,
    loadingConv: false,
  draftMode: 'general', draftModel: null, view: 'chat', collapsed: false, drawer: false,
  browser: { inst: null, layout: 'none', collapsed: false, full: false, mtab: 'chat', width: 0 }, media: null,
    speaking: null,
  stick: true, lastTop: 0, userInput: 0, seen: {}, ro: null
};
CW.S = S;
 CW.MODES = MODES;

function isMobile() { return innerWidth < 900; }
// Phase 4: brand name, announcement banner and maintenance notice come from the Admin Dashboard (GET /auth/config).
function brandName() { return String((C.config && C.config.brand_name) || 'Colon AI').toUpperCase(); }
// Signed out: chat works, nothing is saved (guest adapter), and Log in / Sign up replace the account menu.
function signedIn() { return !!C.user; }
function ephemeral() { return data && data.kind === 'guest'; }
function $(s) { return S.el.querySelector(s); }
function mode() { return S.current ? S.current.mode : S.draftMode; }
function modelId() { return (S.current && S.current.model) || S.draftModel || defaultModel(); }
function defaultModel() { var d = S.models.filter(function (m) { return m.default; })[0] || S.models.filter(function (
  m) { return m.available; })[0]; return d ? d.id : null; }
function modelName(id) { var m = S.models.filter(function (x) { return x.id === id; })[0];
  return m ? m.name : 'Colon Saga'; }
// Research mode: what the server is doing before the answer starts (SSE "status" events).
var STAGES = {
  searching: function () { return 'Searching the web…'; },
  reading: function (n) { return 'Reading ' + n + ' source' + (n === 1 ? '' : 's') + '…'; },
  writing: function (n) { return n ? 'Writing from ' + n + ' source' + (n === 1 ? '' : 's') + '…' : 'Writing…'; },
  unavailable: function () { return 'Web search unavailable. Answering anyway…'; }
};
function rafThrottle(fn) { var q = false; return function () { if (q) return; q = true; requestAnimationFrame(function (
  ) { q = false; fn(); }); }; }

export { $, CAPS, DEV_ACTIONS, MODES, PROMPTS, S, STAGES, brandName, data, defaultModel, ephemeral, isMobile, mode,
  modelId, modelName, rafThrottle, setData, signedIn };
