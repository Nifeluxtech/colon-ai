// Workspace folders (v0.31.0, the IDE tab's Files tree). A folder is the shared start of its files' paths
// ("css/site.css" is in "css"); an empty one is kept as "<folder>/.gitkeep" (paths.KEEP). Moving or deleting a folder
// changes every file in it as ONE version, so Undo / History brings it all back.
//   moveFolder(u, id, { from, to })   rename or move a folder (refused when a file would land on an existing one)
//   deleteFolder(u, id, path)         delete a folder and everything in it
const paths = require('./paths');

const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });

function cleanFolder(v, field) {
  const s = String(v == null ? '' : v).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!s) throw err(422, 'invalid', 'Give the folder a name.', { field });
  paths.cleanPath(`${s}/${paths.KEEP}`);   // the same rules as a file path (characters, depth, no "..")
  return s;
}

function createFolders({ store, owned, commit }) {
  async function moveFolder(u, id, b = {}) {
    const w = await owned(u, id);
    const from = cleanFolder(b.from, 'from'), to = cleanFolder(b.to, 'to');
    if (from === to) return { version: Number(w.version), moved: 0 };
    if (`${to}/`.startsWith(`${from}/`)) {
      throw err(422, 'invalid', 'A folder can’t move inside itself.', { field: 'to' });
    }
    const all = await store.allFiles(w.id);
    const inside = all.filter((f) => f.path.startsWith(`${from}/`));
    if (!inside.length) throw err(404, 'not_found', 'That folder doesn’t exist.');
    const taken = new Set(all.map((f) => f.path));
    const plan = inside.map((f) => ({ f, to: paths.cleanPath(to + f.path.slice(from.length)) }));
    const clash = plan.find((x) => taken.has(x.to));
    if (clash) throw err(409, 'exists', `${clash.to} already exists.`, { field: 'to' });
    for (const x of plan) {
      await store.putFile(w.id, { path: x.to, mime: paths.typeOf(x.to).mime, content: Buffer.from(x.f.content) });
    }
    for (const x of plan) await store.deleteFile(w.id, x.f.path);
    return { version: await commit(u, w, `Moved folder ${from} to ${to}`), moved: plan.length };
  }

  async function deleteFolder(u, id, p) {
    const w = await owned(u, id);
    const folder = cleanFolder(p, 'path');
    const inside = (await store.files(w.id)).filter((f) => f.path.startsWith(`${folder}/`));
    if (!inside.length) throw err(404, 'not_found', 'That folder doesn’t exist.');
    for (const f of inside) await store.deleteFile(w.id, f.path);
    return { version: await commit(u, w, `Deleted folder ${folder}`), deleted: inside.length };
  }
  return { moveFolder, deleteFolder };
}

module.exports = { createFolders, cleanFolder };
