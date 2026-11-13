// robots.txt for the server reader: the group for "ColonReader" (or "*" when there is none) decides, with the
// usual longest-match rule (Allow wins a tie) and the `*` and `$` wildcards. A missing file (4xx) allows
// everything; a site whose robots.txt can't be read (5xx, timeout) is read anyway: the reader opens one page a
// user asked for, it never crawls. Parsed files are kept for an hour per origin.

const AGENT = 'colonreader';

// Text of a robots.txt -> [{ agents: [...], rules: [{ allow, path }] }]
function parse(text) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'disallow' && !val) continue;   // "Disallow:" (empty) allows everything
      cur.rules.push({ allow: key === 'allow', path: val });
    } else lastWasAgent = false;
  }
  return groups;
}

// The rules that apply to our agent: every group naming it (by product token), else every "*" group.
function rulesFor(groups, agent = AGENT) {
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && a.split('/')[0].trim() === agent));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return use.flatMap((g) => g.rules);
}

function toRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function normPath(p) {
  try { return decodeURIComponent(p); } catch { return p; }
}

/** allowed(groups, '/path?query') -> boolean */
function allowed(groups, pathAndQuery, agent = AGENT) {
  const target = normPath(pathAndQuery || '/');
  let best = null;
  for (const r of rulesFor(groups, agent)) {
    if (!toRegex(normPath(r.path)).test(target)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

/**
 * createRobots({ fetchText, ttlMs = 1 h, max = 300 }) -> { check(URL, signal, ctx) -> boolean, clear() }
 * fetchText(robotsUrl, signal, ctx) -> { status, text } (the reader passes its own SSRF-guarded fetch; ctx is
 * handed through untouched).
 */
function createRobots({ fetchText, ttlMs = 60 * 60 * 1000, max = 300 }) {
  const cache = new Map();
  async function groupsFor(u, signal, ctx) {
    const origin = u.origin;
    const hit = cache.get(origin);
    if (hit && Date.now() - hit.at < ttlMs) return hit.groups;
    let groups = [];
    try {
      const r = await fetchText(origin + '/robots.txt', signal, ctx);
      groups = r.status >= 200 && r.status < 300 ? parse(r.text) : [];
    } catch { groups = []; }   // unreachable robots.txt: read the page (see the note above)
    cache.set(origin, { groups, at: Date.now() });
    while (cache.size > max) cache.delete(cache.keys().next().value);
    return groups;
  }
  return {
    async check(u, signal, ctx) { return allowed(await groupsFor(u, signal, ctx), u.pathname + u.search); },
    clear() { cache.clear(); },
  };
}

module.exports = { parse, allowed, createRobots, AGENT };
