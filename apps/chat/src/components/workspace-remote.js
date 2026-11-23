/* Colon AI · Workspace server databases (v0.31.0): a Supabase, Firebase, Appwrite or PocketBase connection that
   also has server access (a service_role key, service account, API key or superuser login, kept encrypted on the
   server and never shown again). Colon's chat then reads and changes that database itself; here the owner sees its
   tables and can browse rows.
     remoteHtml(st)          the section (st = GET /workspaces/:id/data)
     bindRemote(el, o, st)   loads each database's tables; o = { id, data } */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
var DB = { supabase: 'Supabase', firebase: 'Firebase', appwrite: 'Appwrite', pocketbase: 'PocketBase' };

function where(v) { return String(v.url || v.endpoint || v.projectId || '').replace(/^https:\/\//, ''); }
function dbs(st) { return (st.connections || []).filter(function (c) { return DB[c.provider] && c.server; }); }
function remoteHtml(st) {
  var list = dbs(st);
  if (!list.length) return '';
  return '<section class="wk-dsec"><div class="wk-dhead"><h3>' + icon('database') + 'Connected databases</h3></div>'
    + list.map(function (c) {
      return '<div class="wk-git" data-rdb="' + esc(c.provider) + '"><div class="wk-git-h">' + icon('database')
        + '<span><b>' + esc(DB[c.provider]) + '</b><small>' + esc(where(c.config || {})) + '</small></span><em '
        + 'class="wk-on">' + icon('check') + 'Colon can edit'
        + '</em></div><p class="wk-note">Colon reads and changes this database when you ask in Chat. It won’t drop '
        + 'tables or delete every row unless you say so.' + ((c.state || {}).sql === false ? ' Add a personal access '
          + 'token to let Colon create or change tables.' : '') + '</p><div class="wk-rdb" data-tables><div '
        + 'class="skel '
        + 'px-skel-c"></div></div></div>';
    }).join('') + '</section>';
}
function cell(v) {
  if (v === null || v === undefined) return '<i class="muted">null</i>';
  return esc(typeof v === 'object' ? JSON.stringify(v) : String(v));
}
function browse(o, c, t) {
  C.sheet('<div class="px-sheet"><h2 class="h3">' + esc(t.name) + '</h2><p class="small muted">' + esc(DB[c.provider])
    + ' · newest 50 rows</p><div class="wk-grid" data-g><div class="skel px-skel-c"></div></div><div '
    + 'class="sheet-actions"><button type="button" class="btn ghost" data-close>Close</button></div></div>',
  function (el) {
    o.data.workspaceRemoteRows(o.id, c.provider, t.name).then(function (d) {
      var rows = d.rows || [], cols = d.columns && d.columns.length ? d.columns : Object.keys(rows[0] || {});
      el.querySelector('[data-g]').innerHTML = rows.length ? '<table><thead><tr>' + cols.map(function (k) {
        return '<th>' + esc(k) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' + cols.map(function (k) { return '<td>' + cell(r[k]) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>' : '<p class="px-empty">No rows yet.</p>';
    }).catch(function (e) { el.querySelector('[data-g]').innerHTML = '<p class="px-empty">' + esc(e.message)
      + '</p>'; });
  }, { label: t.name, cls: 'wide' });
}
function bindRemote(el, o, st) {
  dbs(st).forEach(function (c) {
    var box = el.querySelector('[data-rdb="' + c.provider + '"] [data-tables]');
    if (!box) return;
    o.data.workspaceRemoteTables(o.id, c.provider).then(function (d) {
      if (!box.isConnected) return;
      var list = d.tables || [];
      box.innerHTML = list.length ? list.map(function (t, i) {
        return '<button type="button" class="wk-rdb-t" data-t="' + i + '">' + icon('list') + '<b>' + esc(t.name)
          + '</b><small>' + (t.rows == null ? '' : esc(String(t.rows)) + ' rows · ') + esc(String((t.columns
            || []).length)) + ' cols</small>' + icon('chev') + '</button>';
      }).join('') : '<p class="px-empty">No tables yet. Ask Colon in Chat to create one.</p>';
      box.querySelectorAll('[data-t]').forEach(function (b) { b.addEventListener('click', function () {
        browse(o, c, list[Number(b.getAttribute('data-t'))]); }); });
    }).catch(function (e) { box.innerHTML = '<p class="wk-note">' + esc(e.message) + '</p>'; });
  });
}

export { remoteHtml, bindRemote, DB };
