// Projects (v0.15.0, Blueprint step B10): a named place for related chats, files and memories, with standing
// instructions that go into every reply in it.
//
//   limit      how many projects a user may have comes from the plan entitlement 'projects' (modules/billing,
//              Free 2 · Startup 5 · Pro 15 · Pro Plus 30 · Max 100 by default, editable in Admin › Plans).
//              BILLING_MODE=enforce refuses a project over the limit (402, code quota, reason projects);
//              shadow allows it and logs it (over_limit: true in the answer); off has no limit. Staff: no limit.
//   delete     the project and its memories go; its chats and files stay and move back out of it.
//   ownership  every store statement is scoped to the user; another user's project answers 404.
const crypto = require('crypto');
const config = require('../../config');
const billing = require('../billing');
const { sqlStore, memoryStore } = require('./store');
const log = require('../../shared/logger');

const MAX_NAME = 80;
const MAX_INSTRUCTIONS = 4000;
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });
const notFound = () => err(404, 'not_found', 'This project no longer exists.');
const newId = () => crypto.randomBytes(12).toString('base64url');
const json = (v) => { if (v == null || typeof v === 'object') return v || {}; try { return JSON.parse(v); } catch {
  return {}; } };

function projectOut(p) {
  return { id: p.id, name: p.name, instructions: p.instructions || '', chats: Number(p.chats) || 0,
    files: Number(p.files) || 0, created_at: p.created_at, updated_at: p.updated_at };
}
const fileOut = (f) => { const m = json(f.meta); return { id: f.id, name: f.name, type: f.mime, size: f.size,
  kind: f.kind, pages: m.pages, words: m.words, created_at: f.created_at }; };

function cleanName(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s || s.length > MAX_NAME) {
    throw err(422, 'invalid', `Use a name of 1 to ${MAX_NAME} characters.`, { field: 'name' });
  }
  return s;
}
function cleanInstructions(v) {
  const s = String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
  if (s.length > MAX_INSTRUCTIONS) {
    throw err(422, 'invalid', `Instructions can be up to ${MAX_INSTRUCTIONS} characters.`, { field: 'instructions' });
  }
  return s || null;
}

// bill: { mode(), billable(user), planFor(userId) } (modules/billing by default; a fake in tests).
const defaultBill = { mode: () => config.billing.mode, billable: billing.billable,
  planFor: (id) => billing.instance().planFor(id) };

function create({ store = sqlStore(), bill = defaultBill } = {}) {
  const uid = (u) => { if (!u || !u.id) throw err(401, 'unauthorized', 'Log in to use projects.'); return u.id; };

  // -> { limit (null = none), used, mode, plan }
  async function limitFor(u) {
    const used = await store.count(uid(u));
    const mode = bill.mode();
    if (mode === 'off' || !bill.billable(u)) return { limit: null, used, mode, plan: null };
    const plan = await bill.planFor(u.id);
    const ent = plan && plan.entitlements && plan.entitlements.projects;
    const limit = !ent || !ent.enabled ? 0 : ent.limit;
    return { limit: limit == null ? null : Number(limit), used, mode, plan: plan ? plan.name : null };
  }

  async function list(u) {
    const id = uid(u);
    return { projects: (await store.list(id)).map(projectOut), limit: await limitFor(u) };
  }

  async function add(u, b = {}) {
    const id = uid(u);
    const name = cleanName(b.name);
    const instructions = cleanInstructions(b.instructions);
    const lim = await limitFor(u);
    const over = lim.limit != null && lim.used >= lim.limit;
    if (over && lim.mode === 'enforce') {
      throw err(402, 'quota', `Your ${lim.plan || 'current'} plan includes ${lim.limit} project${lim.limit === 1 ? ''
        : 's'}. Delete one or upgrade your plan to add more.`, { reason: 'projects' });
    }
    if (over) log.warn('projects_over_limit', { user: id, used: lim.used, limit: lim.limit, mode: lim.mode });
    const pid = newId();
    await store.insert({ id: pid, user_id: id, name, instructions });
    return { project: projectOut(await store.get(id, pid)), over_limit: over };
  }

  async function get(u, pid) {
    const id = uid(u);
    const p = await store.get(id, pid);
    if (!p) throw notFound();
    const chats = (await store.chats(id, p.id)).map((c) => ({ id: c.id, title: c.title, mode: c.mode,
      pinned: Boolean(c.pinned), archived: Boolean(c.archived), preview: c.preview || '', project_id: p.id,
      created_at: c.created_at, updated_at: c.updated_at }));
    return { project: projectOut(p), chats, files: (await store.files(id, p.id)).map(fileOut) };
  }

  async function edit(u, pid, b = {}) {
    const id = uid(u);
    const fields = {};
    if (b.name !== undefined) fields.name = cleanName(b.name);
    if (b.instructions !== undefined) fields.instructions = cleanInstructions(b.instructions);
    if (!(await store.update(id, pid, fields))) throw notFound();
    return projectOut(await store.get(id, pid));
  }

  async function remove(u, pid) { if (!(await store.remove(uid(u), pid))) throw notFound(); return true; }

  // For chat and uploads: throws 404 unless this project is the user's. -> the project row.
  async function owned(userId, pid) {
    const p = pid ? await store.get(userId, pid) : null;
    if (!p) throw notFound();
    return p;
  }

  // For chat replies: the project's instructions and its files (with their extracted text). null when none.
  async function contextFor(userId, pid) {
    if (!userId || !pid) return null;
    const p = await store.get(userId, pid);
    if (!p) return null;
    const files = await store.files(userId, p.id, { text: true });
    return { id: p.id, name: p.name, instructions: p.instructions || '', files };
  }

  return { list, add, get, edit, remove, owned, contextFor, limitFor, store };
}

let shared = null;
const instance = () => (shared || (shared = create()));

module.exports = {
  create, instance, memoryStore, projectOut, MAX_NAME, MAX_INSTRUCTIONS,
  owned: (userId, pid) => instance().owned(userId, pid),
  contextFor: (userId, pid) => instance().contextFor(userId, pid),
  count: (userId) => instance().store.count(userId),
  handlers: require('./handlers'),
};
