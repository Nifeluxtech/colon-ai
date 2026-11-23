// Shared by the remote/ adapters that have no server-side filter language Colon can safely build (PocketBase,
// Appwrite, Firebase): rows are fetched (at most SCAN) and matched here with the same `where` shape Supabase uses:
// { col: value } or { col: { eq|neq|gt|gte|lt|lte|in|like: value } }.
const SCAN = 500;
const NAME = /^[A-Za-z_][\w-]{0,63}$/;
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

function name(v, what = 'table') {
  if (!NAME.test(String(v || ''))) throw err(422, 'invalid', `“${String(v).slice(0, 40)}” isn’t a valid ${what} name.`);
  return String(v);
}
function test(have, op, want) {
  if (op === 'eq') return have == want;   // eslint-disable-line eqeqeq
  if (op === 'neq') return have != want;   // eslint-disable-line eqeqeq
  if (op === 'gt') return have > want;
  if (op === 'gte') return have >= want;
  if (op === 'lt') return have < want;
  if (op === 'lte') return have <= want;
  if (op === 'in') return [].concat(want).some((w) => w == have);   // eslint-disable-line eqeqeq
  if (op === 'like' || op === 'ilike') {
    const re = new RegExp(`^${String(want).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
    return re.test(String(have));
  }
  if (op === 'is') return want === null ? have == null : have === want;
  throw err(422, 'invalid', `Unknown filter “${op}”.`);
}
function match(row, where = {}) {
  return Object.entries(where || {}).every(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.entries(v).every(([op, x]) => test(row[k], op, x)) : test(row[k], 'eq', v)));
}
const cap = (n, d = 50) => Math.min(200, Math.max(1, Number(n) || d));

module.exports = { SCAN, name, match, cap };
