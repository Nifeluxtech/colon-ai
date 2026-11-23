/* Colon AI · Workspace "needs" lines (v0.29.0, Workspace step 5; plan: docs/workspace/plan.md). When a build needs a
   database table or a secret key the site doesn't have yet, the model adds a line to its note (prompt.js):
     === NEEDS: table orders read=owner add=public -- orders from the checkout
     === NEEDS: secret PAYSTACK_KEY host=api.paystack.co as=bearer -- take card payments
     === NEEDS: connection supabase -- log in and register (v0.30.0)
   split() takes them out of the text the user reads; the chat shows each as a card that opens the Data tab's form.
   v0.31.0: "=== EXPORT: zip -- 12 files, 40 KB" (added by Colon's server when the user asks for their files as a
   zip) becomes { kind: 'export', name: 'zip', why: '12 files, 40 KB' }: a Download ZIP card.
   Pure and DOM-free. */

var EXPORT = /^\s*===\s*EXPORT\s*:\s*zip\b(.*)$/i;
var LINE = /^\s*===\s*NEEDS\s*:\s*(table|database|secret|key|connection|connect)\s+([A-Za-z][A-Za-z0-9_-]*)(.*)$/i;

function opts(rest) {
  var why = '', m = rest.split(/\s+--\s+|\s+—\s+/);
  if (m.length > 1) why = m.slice(1).join(' - ').trim();
  var o = { why: why };
  m[0].replace(/(\w+)=(\S+)/g, function (all, k, v) { o[k.toLowerCase()] = v; return all; });
  return o;
}

/** text -> { text, needs: [{ kind: 'table'|'secret'|'connection'|'export', name, read?, add?, host?, as?, why }] } */
function split(text) {
  var keep = [], needs = [], seen = {};
  String(text || '').split('\n').forEach(function (line) {
    var x = EXPORT.exec(line);
    if (x) {
      if (!seen.export) needs.push({ kind: 'export', name: 'zip', why: opts(x[1] || '').why });
      seen.export = 1;
      return;
    }
    var m = LINE.exec(line);
    if (!m) { keep.push(line); return; }
    var kind = /^(table|database)$/i.test(m[1]) ? 'table' : /^conn/i.test(m[1]) ? 'connection' : 'secret';
    var o = opts(m[3] || '');
    var name = kind === 'secret' ? m[2].toUpperCase().replace(/-/g, '_') : m[2].toLowerCase();
    if (seen[kind + name]) return;
    seen[kind + name] = 1;
    var n = { kind: kind, name: name, why: o.why };
    if (kind === 'table') {
      n.read = o.read === 'public' ? 'public' : 'owner';
      n.add = o.add === 'public' ? 'public' : 'owner';
    } else if (kind === 'secret') {
      n.host = o.host ? String(o.host).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() : '';
      n.as = /^(bearer|header:[A-Za-z0-9-]+|query:[A-Za-z0-9_.-]+)$/.test(o.as || '') ? o.as : 'bearer';
    }
    needs.push(n);
  });
  return { text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), needs: needs };
}

/** Is this need already met by the workspace's data ({ secrets[], collections[] })? */
function met(n, d) {
  if (!d || n.kind === 'export') return false;
  if (n.kind === 'connection') {
    return (d.connections || []).some(function (x) { return x.provider === n.name; });
  }
  var list = n.kind === 'table' ? d.collections || [] : d.secrets || [];
  return list.some(function (x) { return x.name === n.name; });
}

export { split, met };
