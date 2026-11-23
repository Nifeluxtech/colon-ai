// Workspace chat tools (v0.31.0): with server access to a connected database or Git repository, Colon's builder can
// act on them, not only write code. The model adds blocks to its reply (parsed here, next to edits.js's FILE blocks):
//
//   === DB: <provider>        a JSON op or a list of ops (remote/index.js shapes), up to "=== END"
//   === SQL: <provider>       SQL (Supabase with a personal access token), up to "=== END"
//   === COMMIT: <provider> [branch=<name>] -- <message>          commit & push every workspace file
//   === PR: <provider> <head> -> <base> -- <title>               open a pull request
//   === MERGE: <provider> #<number>   or   <head> -> <base>      merge a pull request or a branch
//
// A small loop (at most ROUNDS extra model calls): a reply with ONLY read blocks (tables, select, SELECT …) gets the
// results back and answers again. Everything else runs after the file changes are saved (so a commit pushes them),
// in the order written; each one is a build step, and its outcome is added to Colon's note. Dropping or emptying a
// table, and an update or delete with no filter, are refused unless the user's own message asks for it.
const { isRead } = require('./remote');

const ROUNDS = 3, SCHEMA_MS = 8000, RESULT_CHARS = 6000;
const HEAD = /^===\s*(DB|SQL|COMMIT|PR|MERGE)\s*:\s*(.*?)\s*$/i;
const END = /^===\s*END\s*(===)?\s*$/i;
const FILES = /^===\s*(FILE|EDIT|DELETE)\s*:/im;
const ASKS_DESTRUCTIVE = new RegExp('\\b(drop|truncate|wipe|empty|clear|delete|remove|update|reset|set)\\b[^.?!]{0,40}'
  + '\\b(table|all|every|everything|rows?|records?|data)\\b', 'i');
const short = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n
  ? `${s.slice(0, n)}…` : s; };

// text -> { text (without tool blocks), calls: [{ kind, provider, ops?|sql?|message?|branch?|head?|base?|… }] }
function extract(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'), keep = [], calls = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEAD.exec(lines[i].trim());
    if (!m) { keep.push(lines[i]); continue; }
    const kind = m[1].toUpperCase(), rest = m[2];
    const provider = (/^([a-z]+)/i.exec(rest) || [])[1] ? (/^([a-z]+)/i.exec(rest))[1].toLowerCase() : '';
    const tail = rest.slice(provider.length).trim();
    if (kind === 'DB' || kind === 'SQL') {
      const body = [];
      const more = () => i + 1 < lines.length && !END.test(lines[i + 1].trim()) && !HEAD.test(lines[i + 1].trim());
      while (more()) body.push(lines[++i]);
      if (i + 1 < lines.length && END.test(lines[i + 1].trim())) i++;
      const src = body.join('\n').replace(/^\s*```\w*\s*$/gm, '').trim();
      if (kind === 'SQL') { calls.push({ kind, provider, ops: [{ op: 'sql', sql: src }] }); continue; }
      let ops;
      try { ops = [].concat(JSON.parse(src)); } catch { ops = null; }
      calls.push(ops ? { kind, provider, ops } : { kind, provider, error: 'The database block wasn’t valid JSON.' });
    } else if (kind === 'COMMIT') {
      const [opts, ...msg] = tail.split(/\s+--\s+/);
      const branch = (/branch=([^\s]+)/.exec(opts || '') || [])[1] || '';
      calls.push({ kind, provider, branch, message: (msg.join(' -- ') || opts.replace(/branch=\S+/, '')).trim() });
    } else {
      const [spec, ...title] = tail.split(/\s+--\s+/);
      const num = /#(\d+)/.exec(spec || ''), arrow = /([^\s]+)\s*->\s*([^\s]+)/.exec(spec || '');
      calls.push({ kind, provider, number: num ? Number(num[1]) : null, head: arrow ? arrow[1] : '',
        base: arrow ? arrow[2] : '', title: title.join(' -- ').trim() });
    }
  }
  return { text: keep.join('\n'), calls };
}
const onlyReads = (calls) => calls.length > 0 && calls.every((c) => (c.kind === 'DB' || c.kind === 'SQL') && c.ops
  && c.ops.every(isRead));

function createTools({ remote, git }) {
  // u, workspace id, the user's message, info = data overview -> the kit for this build, or null
  async function prepare(u, id, message, info) {
    const conns = ((info && info.connections) || []).filter((c) => c.server);
    const dbs = conns.filter((c) => remote.providers.includes(c.provider));
    const repos = conns.filter((c) => git.providers.includes(c.provider));
    if (!dbs.length && !repos.length) return null;
    const allow = ASKS_DESTRUCTIVE.test(String(message));
    const schemas = await Promise.all(dbs.map((c) => Promise.race([remote.schema(u, id, c.provider),
      new Promise((ok) => { const t = setTimeout(() => ok({ text: '(the schema didn’t load in time)' }), SCHEMA_MS);
        if (t.unref) t.unref(); })]).catch((e) => ({ text: `(couldn’t read it: ${short(e.message, 120)})` }))));
    const prompt = [
      'Tools: Colon has SERVER access to these services and can act on them for the user. Use them when the user '
      + 'asks to store, change or check data, or to commit / push / merge. Add the blocks after your note:',
      ...dbs.map((c, i) => `- Database ${c.provider} (${schemas[i].canSql ? 'SQL allowed' : 'no SQL: use ops'}):\n${
        schemas[i].text}`),
      dbs.length ? `=== DB: <provider>\n{"op":"select","table":"orders","where":{"status":"paid"},"limit":20}\n=== END
  ops: tables | select {table, where?, limit?, order?("-col" for newest)} | insert {table, rows:[{…}]} |
  update {table, where, values} | delete {table, where} | createTable {table, columns:[{name,type,required?}]} |
  addColumn {table, column:{name,type}}; where = {"col": value} or {"col":{"gt":5}} (eq neq gt gte lt lte like in).
  Several ops: a JSON list.${dbs.some((c, i) => schemas[i].canSql) ? '\n=== SQL: supabase\n(SQL)\n=== END' : ''}
  To look first, send ONLY read blocks (tables, select, SELECT) and nothing else; you'll get the results and answer
  again. Never drop or empty a table, or update / delete without "where", unless the user clearly asked.` : '',
      ...repos.map((c) => `- Git ${c.provider}: ${c.config.repo} (branch ${c.config.branch || 'default'}${c.config
        .folder ? `, folder ${c.config.folder}/` : ''})`),
      repos.length ? `=== COMMIT: <provider> [branch=<new-branch>] -- <commit message>   (pushes ALL workspace files
  after your FILE changes are saved; only when the user asks to commit / push / save to GitHub or Bitbucket)
=== PR: <provider> <head-branch> -> <base-branch> -- <title>
=== MERGE: <provider> #<pull request number>    or    === MERGE: <provider> <head-branch> -> <base-branch>
  Merge only when the user asks.` : ''].filter(Boolean).join('\n');

    async function runDb(c, t, results) {
      for (const op of c.ops) {
        const label = `${c.provider}: ${op.op || 'sql'}${op.table ? ` ${op.table}` : ''}`;
        await t.start(`Database ${label}`);
        try {
          const r = await remote.run(u, id, c.provider, op, { allowDestructive: allow });
          await t.done(short(r.rows ? `${r.rows.length} rows` : r.tables ? `${r.tables.length} tables` : r, 100));
          results.push({ ok: true, label, r });
        } catch (e) { await t.fail(e.message); results.push({ ok: false, label, error: e.message }); }
      }
    }
    async function runGit(c, t, results) {
      const label = `${c.provider} ${c.kind.toLowerCase()}`;
      await t.start(c.kind === 'COMMIT' ? `Committing and pushing to ${c.provider}` : c.kind === 'PR'
        ? `Opening a pull request on ${c.provider}` : `Merging on ${c.provider}`);
      try {
        const r = c.kind === 'COMMIT' ? await git.commit(u, id, c.provider, { message: c.message, branch: c.branch })
          : c.kind === 'PR' ? await git.openPull(u, id, c.provider, { head: c.head, base: c.base, title: c.title })
            : await git.merge(u, id, c.provider, c.number ? { number: c.number } : { head: c.head, base: c.base });
        await t.done(r.sha ? String(r.sha).slice(0, 7) : r.number ? `#${r.number}` : 'done');
        results.push({ ok: true, label, r, c });
      } catch (e) { await t.fail(e.message); results.push({ ok: false, label, error: e.message }); }
    }
    async function exec(calls, t) {
      const results = [];
      for (const c of calls) {
        if (c.error) { results.push({ ok: false, label: c.provider, error: c.error }); continue; }
        if (c.kind === 'DB' || c.kind === 'SQL') await runDb(c, t, results); else await runGit(c, t, results);
      }
      return results;
    }
    const asText = (results) => results.map((x) => `${x.label}: ${x.ok ? short(x.r, RESULT_CHARS / Math.max(1,
      results.length)) : `FAILED: ${x.error}`}`).join('\n');

    // r = the first reply; gen(extraMessages) asks again -> the final reply
    async function loop(r, gen, t) {
      for (let round = 0; round < ROUNDS; round++) {
        const ex = extract(r.text);
        if (FILES.test(r.text) || !onlyReads(ex.calls)) return r;
        const results = await exec(ex.calls, t);
        await t.start('Thinking with the results');
        r = await gen([{ role: 'assistant', content: r.text }, { role: 'user', content: `Results:\n${asText(results)}\n`
          + 'Now finish the request: your note for the user, then any FILE / EDIT / DB / COMMIT blocks.' }]);
        await t.done();
      }
      return r;
    }
    function summary(x) {
      if (!x.ok) return `Couldn’t do ${x.label}: ${x.error}`;
      const r = x.r || {};
      if (x.c && x.c.kind === 'COMMIT') return `Pushed ${r.files} files to ${r.branch} (${String(r.sha).slice(0, 7)}).`;
      if (x.c && x.c.kind === 'PR') return `Opened pull request #${r.number}.`;
      if (x.c && x.c.kind === 'MERGE') return r.already ? 'Nothing to merge: already up to date.' : 'Merged.';
      if (r.inserted != null) return `${x.label}: added ${r.inserted} row${r.inserted === 1 ? '' : 's'}.`;
      if (r.updated != null) return `${x.label}: updated ${r.updated} row${r.updated === 1 ? '' : 's'}.`;
      if (r.deleted != null) return `${x.label}: deleted ${r.deleted} row${r.deleted === 1 ? '' : 's'}.`;
      if (r.created || r.added) return `${x.label}: done.`;
      return '';
    }
    // after the files are saved: run the final reply's blocks -> lines for the note
    async function after(text, t) {
      const { calls } = extract(text);
      return (await exec(calls, t)).map(summary).filter(Boolean);
    }
    return { prompt, loop, after, strip: (text) => extract(text).text };
  }
  return { prepare };
}

module.exports = { createTools, extract, onlyReads, ASKS_DESTRUCTIVE, ROUNDS };
