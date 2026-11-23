// Workspace (v0.25.0, Workspace step 1; plan: docs/workspace/plan.md): a chat-first website builder. This module
// keeps a user's workspaces, their files and a version after every change. Step 2 (v0.26.0) adds chat edits
// (applyOps here, the chat itself in chat.js), step 3 the
// preview, step 4 publishing to apparatus.name.ng/<name>/.
//
//   limits     paths.js LIMITS: workspaces per user, files per workspace, bytes per file and in total.
//   files      text is stored as UTF-8 and returned with encoding 'utf8'; images and fonts as bytes, returned base64.
//   versions   every change (create, save, rename, delete, restore) adds a snapshot; the newest 20 are kept and any
//              of them can be restored (which itself adds a version, so a restore can be undone).
//   ownership  every call is scoped to the user; another user's workspace answers 404.
const crypto = require('crypto');
const { sqlStore, memoryStore } = require('./store');
const paths = require('./paths');
const templates = require('./templates');
const edits = require('./edits');
const { createPublisher, siteUrl } = require('./publish');
const { createFolders } = require('./folders');

const { LIMITS } = paths;
const MAX_TITLE = 80;
const MAX_INSTRUCTIONS = 4000;
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });
const notFound = () => err(404, 'not_found', 'This workspace no longer exists.');
const newId = () => crypto.randomBytes(12).toString('base64url');

const wsOut = (w) => ({ id: w.id, title: w.title, template: w.template, version: Number(w.version) || 0,
  files: Number(w.files) || 0, bytes: Number(w.bytes) || 0, instructions: w.instructions || '',
  reference: w.ref_url ? { url: w.ref_url, files: Number(w.ref_files) || 0 } : null, published: w.slug ? { name: w.slug,
    url: siteUrl(w.owner_name, w.slug), version: w.published_version, at: w.published_at } : null,
  created_at: w.created_at, updated_at: w.updated_at });
const fileOut = (f) => ({ path: f.path, type: f.mime, size: Number(f.size), updated_at: f.updated_at });
const isText = (p) => { const t = paths.typeOf(p); return Boolean(t && t.text); };
const contentOut = (f) => ({ ...fileOut(f), encoding: isText(f.path) ? 'utf8' : 'base64',
  content: Buffer.from(f.content).toString(isText(f.path) ? 'utf8' : 'base64') });

function cleanTitle(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s || s.length > MAX_TITLE) {
    throw err(422, 'invalid', `Use a name of 1 to ${MAX_TITLE} characters.`, { field: 'title' });
  }
  return s;
}
const cleanNote = (v, dflt) => String(v || dflt).replace(/\s+/g, ' ').trim().slice(0, 200) || dflt;

function create({ store = sqlStore(), publishRoot } = {}) {
  const pub = createPublisher({ store, root: publishRoot });
  const uid = (u) => { if (!u || !u.id) throw err(401, 'unauthorized', 'Log in to use Workspace.'); return u.id; };
  async function owned(u, id) {
    const w = await store.get(uid(u), id);
    if (!w) throw notFound();
    return w;
  }
  // Saves a snapshot of every file as the next version and bumps the workspace's version number.
  async function commit(u, w, note) {
    const cur = await store.get(u.id, w.id);   // fresh: an earlier step of this call may have moved it on
    const n = (Number(cur && cur.version) || 0) + 1;
    const snap = {};
    for (const f of await store.allFiles(w.id)) snap[f.path] = [f.mime, Buffer.from(f.content).toString('base64')];
    await store.addVersion(w.id, n, note, JSON.stringify(snap), LIMITS.versions);
    await store.update(u.id, w.id, { version: n });
    return n;
  }
  async function checkRoom(w, p, size) {
    const list = await store.files(w.id);
    const existing = list.find((f) => f.path === p);
    if (!existing && list.length >= LIMITS.files) {
      throw err(413, 'too_many_files', `A workspace can hold up to ${LIMITS.files} files.`);
    }
    const total = list.reduce((n, f) => n + Number(f.size), 0) - (existing ? Number(existing.size) : 0) + size;
    if (total > LIMITS.totalBytes) {
      throw err(413, 'too_large', `A workspace can hold up to ${LIMITS.totalBytes / 1048576} MB of files.`);
    }
  }

  async function list(u) {
    const ws = (await store.list(uid(u))).map(wsOut);
    return { workspaces: ws, templates: templates.TEMPLATES, limits: { workspaces: LIMITS.workspaces,
      files: LIMITS.files, bytes: LIMITS.totalBytes, used: ws.length } };
  }

  async function add(u, b = {}) {
    const id = uid(u);
    const title = cleanTitle(b.title);
    const template = templates.known(b.template) ? b.template : 'blank';
    if ((await store.count(id)) >= LIMITS.workspaces) {
      throw err(402, 'quota', `You can have up to ${LIMITS.workspaces} workspaces. Delete one to add another.`,
        { reason: 'workspaces' });
    }
    const wid = newId();
    await store.insert({ id: wid, user_id: id, title, template });
    for (const f of templates.filesFor(template, title)) {
      await store.putFile(wid, { path: f.path, mime: paths.typeOf(f.path).mime, content: f.content });
    }
    await commit(u, await store.get(id, wid), `Started from the ${template} template`);
    return get(u, wid);
  }

  async function get(u, id) {
    const w = await owned(u, id);
    return { workspace: wsOut(w), files: (await store.files(w.id)).map(fileOut) };
  }

  async function edit(u, id, b = {}) {
    const w = await owned(u, id);
    if (b.title !== undefined) await store.update(u.id, w.id, { title: cleanTitle(b.title) });
    if (b.instructions !== undefined) {   // v0.28.0
      const t = String(b.instructions == null ? '' : b.instructions).trim();
      if (t.length > MAX_INSTRUCTIONS) {
        throw err(422, 'invalid', `Keep instructions under ${MAX_INSTRUCTIONS} characters.`, { field: 'instructions' });
      }
      await store.update(u.id, w.id, { instructions: t || null });
    }
    return wsOut(await store.get(u.id, w.id));
  }

  async function remove(u, id) {
    const w = await owned(u, id);
    if (w.slug) await pub.removeSite(w, w.slug).catch(() => {});
    if (!(await store.remove(u.id, id))) throw notFound();
    return true;
  }
  // v0.28.0 (step 4): publishing to apparatus.name.ng/<name>/ (publish.js).
  const checkName = async (u, id, name) => pub.check(await owned(u, id), name);
  const publish = async (u, id, b = {}) => pub.publish(u, await owned(u, id), b.name);
  const unpublish = async (u, id) => pub.unpublish(u, await owned(u, id));
  // v0.30.0: the user's publishing name (apparatus.name.ng/<username>/<site>/)
  const username = async (u) => ({ name: await store.ownerName(uid(u)) });
  const checkUsername = async (u, name) => pub.checkUser({ id: uid(u) }, name);
  const setUsername = async (u, name) => pub.setUser({ id: uid(u) }, name);

  async function readFile(u, id, p) {
    const w = await owned(u, id);
    const f = await store.file(w.id, paths.cleanPath(p));
    if (!f) throw err(404, 'not_found', 'That file doesn’t exist.');
    return contentOut(f);
  }

  // Every file with its content (the preview in step 3 and the publisher in step 4 use this).
  async function bundle(u, id) {
    const w = await owned(u, id);
    return { workspace: wsOut(w), files: (await store.allFiles(w.id)).map(contentOut) };
  }

  async function writeFile(u, id, b = {}) {
    const w = await owned(u, id);
    const p = paths.cleanPath(b.path);
    const content = paths.contentBuffer(p, b.content, b.encoding);
    await checkRoom(w, p, content.length);
    const existed = Boolean(await store.file(w.id, p));
    await store.putFile(w.id, { path: p, mime: paths.typeOf(p).mime, content });
    const version = await commit(u, w, cleanNote(b.note, `${existed ? 'Edited' : 'Added'} ${p}`));
    return { file: fileOut((await store.files(w.id)).find((f) => f.path === p)), version };
  }

  async function moveFile(u, id, b = {}) {
    const w = await owned(u, id);
    const from = paths.cleanPath(b.from), to = paths.cleanPath(b.to);
    if (from === to) return { version: Number(w.version) };
    const f = await store.file(w.id, from);
    if (!f) throw err(404, 'not_found', 'That file doesn’t exist.');
    if (await store.file(w.id, to)) throw err(409, 'exists', `${to} already exists.`, { field: 'to' });
    if (paths.typeOf(from).text !== paths.typeOf(to).text) {
      throw err(422, 'invalid', 'Keep the same kind of file when renaming (text stays text, images stay images).',
        { field: 'to' });
    }
    await store.putFile(w.id, { path: to, mime: paths.typeOf(to).mime, content: Buffer.from(f.content) });
    await store.deleteFile(w.id, from);
    return { version: await commit(u, w, `Renamed ${from} to ${to}`) };
  }

  async function deleteFile(u, id, p) {
    const w = await owned(u, id);
    const clean = paths.cleanPath(p);
    if (!(await store.deleteFile(w.id, clean))) throw err(404, 'not_found', 'That file doesn’t exist.');
    return { version: await commit(u, w, `Deleted ${clean}`) };
  }

  async function versions(u, id) {
    const w = await owned(u, id);
    return { current: Number(w.version), versions: (await store.versions(w.id)).map((v) => ({ n: Number(v.n),
      note: v.note, created_at: v.created_at })) };
  }

  async function restore(u, id, n) {
    const w = await owned(u, id);
    const v = await store.version(w.id, n);
    if (!v) throw err(404, 'not_found', 'That version is no longer kept.');
    const snap = typeof v.files === 'string' ? JSON.parse(v.files) : v.files;
    await store.clearFiles(w.id);
    for (const [p, [mime, b64]] of Object.entries(snap)) {
      await store.putFile(w.id, { path: p, mime, content: Buffer.from(b64, 'base64') });
    }
    const version = await commit(u, w, `Restored version ${v.n}`);
    return { version, files: (await store.files(w.id)).map(fileOut) };
  }

  // v0.26.0 (step 2): applies a chat reply's operations (edits.js) as ONE version. Every operation is checked
  // before anything is written, so a bad reply changes nothing. -> { version, before, changes: [{ op, path }] }
  async function applyOps(u, id, ops, note) {
    const w = await owned(u, id);
    const current = new Map((await store.allFiles(w.id)).map((f) => [f.path, f]));
    const next = new Map(), gone = new Set(), changes = [];
    for (const o of ops) {
      const p = paths.cleanPath(o.path);
      if (!isText(p)) throw err(422, 'invalid', `Colon can only write text files (${p} isn’t one).`);
      const had = next.has(p) ? next.get(p) : gone.has(p) ? null : current.get(p) ? Buffer.from(current.get(p)
        .content) : null;
      if (o.op === 'delete') {
        if (!had) continue;
        next.delete(p); gone.add(p); changes.push({ op: 'deleted', path: p });
        continue;
      }
      let text = o.content;
      if (o.op === 'edit') {
        if (!had) throw err(422, 'edit_failed', `Colon tried to edit ${p}, which doesn’t exist.`);
        text = edits.applyEdit(had.toString('utf8'), o.blocks);
      }
      next.set(p, paths.contentBuffer(p, text, 'utf8')); gone.delete(p);
      changes.push({ op: had ? 'edited' : 'created', path: p });
    }
    if (!changes.length) return { version: Number(w.version), before: Number(w.version), changes };
    const final = new Map(current);
    for (const p of gone) final.delete(p);
    for (const [p, b] of next) final.set(p, { content: b });
    if (final.size > LIMITS.files) {
      throw err(413, 'too_many_files', `A workspace can hold up to ${LIMITS.files} files.`);
    }
    let total = 0;
    for (const f of final.values()) total += Buffer.from(f.content).length;
    if (total > LIMITS.totalBytes) {
      throw err(413, 'too_large', `A workspace can hold up to ${LIMITS.totalBytes / 1048576} MB of files.`);
    }
    for (const p of gone) await store.deleteFile(w.id, p);
    for (const [p, b] of next) await store.putFile(w.id, { path: p, mime: paths.typeOf(p).mime, content: b });
    const seen = new Set();
    const uniq = changes.filter((c) => !seen.has(c.path) && seen.add(c.path));
    return { version: await commit(u, w, cleanNote(note, 'Colon edited the site')), before: Number(w.version),
      changes: uniq };
  }

  // v0.28.0: replaces every file with files [{ path, content: Buffer }] (a cloned repository) as ONE version.
  async function importFiles(u, id, files, note) {
    const w = await owned(u, id);
    if (files.length > LIMITS.files) {
      throw err(413, 'too_many_files', `A workspace can hold up to ${LIMITS.files} files.`);
    }
    if (files.reduce((n, f) => n + f.content.length, 0) > LIMITS.totalBytes) {
      throw err(413, 'too_large', `A workspace can hold up to ${LIMITS.totalBytes / 1048576} MB of files.`);
    }
    const before = (await store.allFiles(w.id)).map((f) => f.path), incoming = new Set(files.map((f) => f.path));
    for (const p of before) if (!incoming.has(p)) await store.deleteFile(w.id, p);
    for (const f of files) {
      await store.putFile(w.id, { path: f.path, mime: paths.typeOf(f.path).mime, content: f.content });
    }
    const had = new Set(before);
    const changes = files.map((f) => ({ op: had.has(f.path) ? 'edited' : 'created', path: f.path }))
      .concat(before.filter((p) => !incoming.has(p)).map((p) => ({ op: 'deleted', path: p })));
    return { version: await commit(u, w, cleanNote(note, 'Imported files')), before: Number(w.version), changes };
  }

  const { moveFolder, deleteFolder } = createFolders({ store, owned, commit });   // v0.31.0
  return { list, add, get, edit, remove, readFile, bundle, writeFile, moveFile, deleteFile, versions, restore,
    applyOps, importFiles, owned, store, checkName, publish, unpublish, username, checkUsername, setUsername,
    moveFolder, deleteFolder };
}

let shared = null;
const instance = () => (shared || (shared = create()));

module.exports = { create, instance, memoryStore, LIMITS, TEMPLATES: templates.TEMPLATES,
  handlers: require('./handlers'), dataHandlers: require('./data-handlers'),
  connHandlers: require('./conn-handlers') };
