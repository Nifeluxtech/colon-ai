// Skills (v0.32.0): picks the bundled skills that fit a message and turns them into prompt text.
//   pick(text, { mode, max }) -> [{ id, title, pack }]   the best matches, strongest first (max 2 by default)
//   block(picked)             -> text for the model's context (each skill's guidance, capped), '' when none
//   list()                    -> every skill with its title, description, source and licence (GET /skills)
// Matching is by words only (no extra model call), so it costs nothing and adds no wait. "use the <title> skill"
// or "/skill <id>" picks one by name. Skill files are read once and cached.
const fs = require('fs');
const path = require('path');
const { SKILLS, SOURCES } = require('./catalog');

const DIR = path.join(__dirname, 'vendor');
const CAP = 6000;          // characters of one skill's guidance in a prompt
const cache = new Map();

function read(s) {
  if (cache.has(s.id)) return cache.get(s.id);
  let raw = '';
  try { raw = fs.readFileSync(path.join(DIR, s.pack, s.id, 'SKILL.md'), 'utf8'); } catch { raw = ''; }
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const desc = fm ? ((/^description:\s*(.*)$/m.exec(fm[1]) || [])[1] || '').replace(/^["']|["']$/g, '') : '';
  const out = { description: desc.trim(), body: (fm ? raw.slice(fm[0].length) : raw).trim() };
  cache.set(s.id, out);
  return out;
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function named(text) {
  const t = norm(text);
  return SKILLS.filter((s) => t.includes(`skill ${norm(s.id)}`) || t.includes(`${norm(s.title)} skill`)
    || t.includes(`${norm(s.id)} skill`));
}

function pick(text, { mode = 'general', max = 2 } = {}) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const forced = named(t);
  const scored = SKILLS.filter((s) => s.modes.includes(mode) && !forced.includes(s)).map((s) => {
    const hits = t.match(new RegExp(s.words.source, 'gi'));
    return { s, n: hits ? hits.length : 0 };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  return [...forced, ...scored.map((x) => x.s)].slice(0, max)
    .map((s) => ({ id: s.id, title: s.title, pack: s.pack }));
}

function block(picked) {
  const parts = (picked || []).map((p) => {
    const s = SKILLS.find((x) => x.id === p.id);
    const body = s ? read(s).body : '';
    if (!body) return '';
    const text = body.length > CAP ? `${body.slice(0, CAP)}\n[...the rest of this skill is left out]` : body;
    return `--- Skill: ${s.title} (${SOURCES[s.pack].url}, ${SOURCES[s.pack].license}) ---\n${text}`;
  }).filter(Boolean);
  if (!parts.length) return '';
  return ['Skills for this request. Follow their method where it helps the user, in your own words, inside the '
    + 'format you were given. You cannot run their scripts, open their files or call other agents: do that part '
    + 'yourself or tell the user. Never mention "skills" unless asked.', ...parts].join('\n\n');
}

function list() {
  return SKILLS.map((s) => ({ id: s.id, title: s.title, description: read(s).description, modes: s.modes,
    source: SOURCES[s.pack].url, license: SOURCES[s.pack].license }));
}

module.exports = { pick, block, list, CAP };
