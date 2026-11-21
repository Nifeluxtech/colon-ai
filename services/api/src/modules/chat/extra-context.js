// Extra system context for a signed-in reply (v0.15.0, Blueprint B9-B10):
//   1. the chat's project: its instructions and its files (file text is untrusted and fenced like any attachment,
//      context.js fileBlock, within PROJECT_FILE_CHARS);
//   2. the user's memories, only when they turned memory on (modules/memory: keyword overlap + recency within
//      MEMORY_TOKEN_BUDGET). Memory off = nothing from memory is added.
//   3. (0.24.0) a question about Colon's own app ("how do I turn on Hey Colon?"): the matching sections of
//      docs/app-guide.md (modules/appguide), with the client's platform and version. Guests get it too.
// Never fatal: a failure here leaves the reply without the extra context.
// v0.24.0: the project's code (its connected repository's snapshot, .zip projects and code/text files) goes to
// Developer mode's project context instead (build() returns it as `code`); other modes get a one-line note.
const memory = require('../memory');
const appguide = require('../appguide');
const projects = require('../projects');
const safety = require('../safety');
const developer = require('../developer');
const { fileBlock } = require('./context');
const log = require('../../shared/logger');

const PROJECT_FILE_CHARS = 8000;   // all of a project's file text together, per reply
const PER_FILE_CHARS = 3000;

function projectBlock(p, guard, { dev = false } = {}) {
  const out = [];
  if (p.instructions) {
    out.push(`This chat is in the user's project “${p.name}”. The user's instructions for every chat in this project `
      + `(follow them unless they conflict with your rules):\n${p.instructions}`);
  } else {
    out.push(`This chat is in the user's project “${p.name}”.`);
  }
  if (p.repo && !dev) {
    out.push(`The project has a connected code repository (${p.repo.files || 0} files). Its code is read in `
      + 'Developer mode: suggest switching to Developer mode for questions about the code.');
  }
  let left = PROJECT_FILE_CHARS;
  const blocks = [];
  for (const f of p.files || []) {
    if (left <= 200) break;
    const meta = typeof f.meta === 'string' ? safeJson(f.meta) : (f.meta || {});
    if (meta.source === 'repo' || (dev && isCode(f, meta))) continue;
    const text = f.text && meta.format !== 'zip' ? String(f.text).slice(0, Math.min(PER_FILE_CHARS, left)) : '';
    left -= text.length;
    blocks.push(fileBlock({ name: f.name, kind: f.kind, text, pages: meta.pages, note: meta.format === 'zip'
      ? `${meta.note || 'Project archive.'} Its code is read in Developer mode.` : meta.note }, false, guard));
  }
  if (blocks.length) out.push(`Files saved in this project:\n\n${blocks.join('\n\n')}`);
  return out.join('\n\n');
}
const isCode = (f, meta) => meta.format === 'zip' || f.kind === 'text';

// The project's code for Developer mode's context (modules/developer contextFor's first list): the repository
// snapshot and .zip projects as { project }, code and text files as { kind: 'text' }.
function codeFiles(p) {
  const out = [];
  for (const f of (p && p.files) || []) {
    const meta = typeof f.meta === 'string' ? safeJson(f.meta) : (f.meta || {});
    if (meta.format === 'zip') {
      const snap = developer.parseSnapshot(f.text);
      if (snap) out.push({ name: f.name, kind: f.kind, project: snap, repo: meta.source === 'repo' });
    } else if (f.kind === 'text') out.push({ name: f.name, kind: 'text', text: f.text || '', size: f.size });
  }
  return out;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

/**
 * build({ user, conv, text, guard, client?, deps? }) -> { block, memoryIds, code, repo }
 *   code: the project's code files for Developer mode (codeFiles), [] in other modes; repo: its repository summary.
 * client: { platform, version, web_version } from the chat app (appguide.client cleans it).
 * deps (tests): { memory: { contextFor }, projects: { contextFor }, appguide: { contextFor } }
 */
async function build({ user, conv, text = '', guard = safety.collector(), client = null, deps = {} }) {
  const mem = deps.memory || memory;
  const proj = deps.projects || projects;
  const guide = (deps.appguide || appguide).contextFor({ text, client });
  const parts = [];
  let memoryIds = [], code = [], repo = null;
  if (!user || !user.id || !conv) return { block: guide, memoryIds, code, repo };
  const dev = conv.mode === 'developer';
  try {
    const p = conv.project_id ? await proj.contextFor(user.id, conv.project_id) : null;
    if (p) {
      parts.push(projectBlock(p, guard, { dev }));
      if (dev) code = codeFiles(p);
      repo = p.repo || null;
    }
  } catch (e) { log.warn('project_context_failed', { err: String(e.message || '').slice(0, 160) }); }
  const m = await mem.contextFor({ user, query: text, projectId: conv.project_id || null, conversationId: conv.id });
  if (m && m.block) { parts.push(m.block); memoryIds = m.ids || []; }
  if (guide) parts.push(guide);
  return { block: parts.join('\n\n'), memoryIds, code, repo };
}

module.exports = { build, projectBlock, codeFiles, PROJECT_FILE_CHARS };
