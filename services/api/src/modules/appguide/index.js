// App guide (0.24.0): Colon knows its own app. docs/app-guide.md says where every setting lives (Hey Colon =
// Settings › Voice › Hey Colon, memory, voice mode, music, song ID, projects, Saga, updates, Display over other apps,
// auto-start on Infinix XOS / Tecno HiOS, …). It is read once, on first use, and split into its "## " sections, each
// with the keys from its <!-- keys: … --> line.
//
//   isAppHelp(text)        a question about using Colon itself ("how do I turn on Hey Colon?", "where is the setting
//                          for memory?", "Hey Colon no dey work"): a how/where/turn-on phrase, plus a word about the
//                          app (Colon, settings, turn on, enable) or a key only the app has (Hey Colon, Saga, …).
//                          "How do I cook jollof?" and "how do I improve my memory?" are not.
//   pick(text)             the sections that match best (at most MAX_SECTIONS, within MAX_CHARS, each scoring more
//                          than half the best); the settings map when none does.
//   contextFor({ text, client }) -> the system-context block, or '' (not an app question, or the guide is missing:
//                          never fatal). client = { platform, version, web_version } from the chat app, so the answer
//                          can say when something is Android-only or needs an update.
const fs = require('fs');
const path = require('path');
const log = require('../../shared/logger');

const GUIDE = path.resolve(__dirname, '../../../../../docs/app-guide.md');
const MAX_SECTIONS = 3;
const MAX_CHARS = 4500;
const OVERVIEW = 'Settings: where things are';

const HOWISH = new RegExp('\\b(?:how (?:do|can|to|would|should|does) (?:i|we|you|it)|how to|where (?:is|are|do|'
  + 'can|does)|where\'?s|can i|is there (?:a|an) (?:way|option|setting)|i can\'?t find|i cannot find|how i go|'
  + 'how i fit|wetin i go do|where i go see|why (?:is|does|doesn\'?t|isn\'?t|can\'?t|won\'?t|my)|not working|'
  + 'no dey work|stopped working|doesn\'?t work|won\'?t (?:work|open|start)|turn (?:it )?(?:on|off)|switch (?:it )?'
  + '(?:on|off)|enable|disable|activate|deactivate|set up|setup|change|allow)\\b', 'i');
const APPISH = new RegExp('\\b(?:colon|this app|the app|in[- ]app|settings?|option|toggle|turn (?:it )?(?:on|off)|'
  + 'switch (?:it )?(?:on|off)|enable|disable|activate)\\b', 'i');
// One-word keys that only mean the app (a multi-word key such as "voice mode" counts as one too).
const STRONG = new Set(['saga', 'cbt', 'wakeword', 'hotword', 'autostart', 'auto-start', 'xos', 'hios', 'infinix',
  'tecno', 'itel', 'overlay', 'folax', 'apk', 'shazam', 'hands-free', 'handsfree', 'wake-word', 'read-aloud']);

let cache = null;

/** parse(markdown) -> [{ title, keys[], body }], one per "## " section. */
function parse(md) {
  return String(md || '').split(/^## /m).slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n');
    const title = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    let body = nl < 0 ? '' : chunk.slice(nl + 1);
    const km = /<!--\s*keys:([\s\S]*?)-->/.exec(body);
    const keys = km ? km[1].split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) : [];
    body = body.replace(/<!--[\s\S]*?-->\n?/g, '').trim();
    return { title, keys, body };
  }).filter((s) => s.title && s.body);
}

function sections() {
  if (cache) return cache;
  try { cache = parse(fs.readFileSync(GUIDE, 'utf8')); } catch (e) {
    log.warn('app_guide_missing', { err: String(e.message || '').slice(0, 160) });
    cache = [];
  }
  return cache;
}
// Tests: use this markdown instead of docs/app-guide.md (null = read the file again).
function load(md) { cache = md == null ? null : parse(md); }

const norm = (t) => ` ${String(t || '').toLowerCase().normalize('NFKC').replace(/[’']/g, '\'')
  .replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ')} `;
const has = (text, key) => text.includes(` ${key} `);
const strong = (k) => /[ ]/.test(k) || STRONG.has(k);

// -> [{ section, score }] for sections whose keys appear in the text, best first. A key scores its word count.
function scored(text) {
  const t = norm(text);
  return sections().map((s) => ({ s, score: s.keys.reduce((n, k) => n + (has(t, k) ? k.split(' ').length : 0), 0),
    strongHit: s.keys.some((k) => strong(k) && has(t, k)) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}

function isAppHelp(text) {
  const t = String(text || '');
  if (!t.trim() || t.length > 600 || !HOWISH.test(t)) return false;
  return APPISH.test(t) || scored(t).some((x) => x.strongHit);
}

function pick(text) {
  // The map only when nothing else matches; a weaker match only when it scores more than half the best one.
  const all = scored(text);
  const rest = all.filter((x) => x.s.title !== OVERVIEW);
  const hits = (rest.length ? rest : all).filter((x, i, list) => x.score * 2 > list[0].score);
  const list = hits.length ? hits.map((x) => x.s) : sections().filter((s) => s.title === OVERVIEW);
  const out = [];
  let used = 0;
  for (const s of list) {
    const size = s.title.length + s.body.length + 8;
    if (out.length >= MAX_SECTIONS || used + size > MAX_CHARS) break;
    out.push(s);
    used += size;
  }
  return out;
}

const PLATFORMS = { android: 'the Colon AI Android app', web: 'the Colon web app', ios: 'Colon on an iPhone (web)',
  desktop: 'the Colon web app on a computer' };
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,23}$/;

/** client({ platform, version, web_version }) -> the cleaned client, or null. Anything unexpected is dropped. */
function client(c) {
  if (!c || typeof c !== 'object') return null;
  const platform = PLATFORMS[String(c.platform || '').toLowerCase()] ? String(c.platform).toLowerCase() : null;
  const version = VERSION.test(String(c.version || '')) ? String(c.version) : null;
  const web = VERSION.test(String(c.web_version || '')) ? String(c.web_version) : null;
  return platform || version ? { platform, version, web_version: web } : null;
}

function clientLine(c) {
  if (!c) return 'The user\'s app and version are unknown.';
  const where = c.platform ? PLATFORMS[c.platform] : 'the Colon app';
  return `The user is on ${where}${c.version ? ` v${c.version}` : ''}`
    + `${c.web_version && c.web_version !== c.version ? ` (chat v${c.web_version})` : ''}.`;
}

function contextFor({ text = '', client: c = null } = {}) {
  try {
    if (!isAppHelp(text)) return '';
    const picked = pick(text);
    if (!picked.length) return '';
    return ['The user is asking how to use the Colon AI app. Answer from Colon\'s own app guide below: give the exact '
      + 'path (for example Settings › Voice › Hey Colon), say when something is only in the Android app or needs a '
      + 'newer version, and never invent a setting that is not here; if the guide does not cover it, say so and '
      + 'point to Help & Support. ' + clientLine(client(c)),
    ...picked.map((s) => `### ${s.title}\n${s.body}`)].join('\n\n');
  } catch (e) {
    log.warn('app_guide_failed', { err: String(e.message || '').slice(0, 160) });
    return '';
  }
}

module.exports = { contextFor, isAppHelp, pick, parse, load, client, sections, GUIDE };
