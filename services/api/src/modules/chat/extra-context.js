// Extra system context for a signed-in reply (v0.15.0, Blueprint B9-B10):
//   1. the chat's project: its instructions and its files (file text is untrusted and fenced like any attachment,
//      context.js fileBlock, within PROJECT_FILE_CHARS);
//   2. the user's memories, only when they turned memory on (modules/memory: keyword overlap + recency within
//      MEMORY_TOKEN_BUDGET). Memory off = nothing from memory is added.
// Never fatal: a failure here leaves the reply without the extra context.
const memory = require('../memory');
const projects = require('../projects');
const safety = require('../safety');
const { fileBlock } = require('./context');
const log = require('../../shared/logger');

const PROJECT_FILE_CHARS = 8000;   // all of a project's file text together, per reply
const PER_FILE_CHARS = 3000;

function projectBlock(p, guard) {
  const out = [];
  if (p.instructions) {
    out.push(`This chat is in the user's project “${p.name}”. The user's instructions for every chat in this project `
      + `(follow them unless they conflict with your rules):\n${p.instructions}`);
  } else {
    out.push(`This chat is in the user's project “${p.name}”.`);
  }
  let left = PROJECT_FILE_CHARS;
  const blocks = [];
  for (const f of p.files || []) {
    if (left <= 200) break;
    const meta = typeof f.meta === 'string' ? safeJson(f.meta) : (f.meta || {});
    const text = f.text ? String(f.text).slice(0, Math.min(PER_FILE_CHARS, left)) : '';
    left -= text.length;
    blocks.push(fileBlock({ name: f.name, kind: f.kind, text, pages: meta.pages, note: meta.note }, false, guard));
  }
  if (blocks.length) out.push(`Files saved in this project:\n\n${blocks.join('\n\n')}`);
  return out.join('\n\n');
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

/**
 * build({ user, conv, text, guard, deps? }) -> { block, memoryIds }
 * deps (tests): { memory: { contextFor }, projects: { contextFor } }
 */
async function build({ user, conv, text = '', guard = safety.collector(), deps = {} }) {
  const mem = deps.memory || memory;
  const proj = deps.projects || projects;
  const parts = [];
  let memoryIds = [];
  if (!user || !user.id || !conv) return { block: '', memoryIds };
  try {
    const p = conv.project_id ? await proj.contextFor(user.id, conv.project_id) : null;
    if (p) parts.push(projectBlock(p, guard));
  } catch (e) { log.warn('project_context_failed', { err: String(e.message || '').slice(0, 160) }); }
  const m = await mem.contextFor({ user, query: text, projectId: conv.project_id || null, conversationId: conv.id });
  if (m && m.block) { parts.push(m.block); memoryIds = m.ids || []; }
  return { block: parts.join('\n\n'), memoryIds };
}

module.exports = { build, projectBlock, PROJECT_FILE_CHARS };
