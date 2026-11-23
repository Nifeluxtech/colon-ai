/* Colon AI · Workspace connections (v0.30.0). Sign-in and database services a site talks to from the browser:
   Supabase, Firebase, Appwrite, PocketBase, Clerk. Their PUBLIC client settings go in the site's files; Colon's
   builder writes login, register and data code with them. v0.31.0: optional server access (a service_role key,
   service account, API key or superuser login) lets Colon itself read and change the database, and GitHub /
   Bitbucket repositories (token) let it commit, push and merge. Server fields are encrypted on the server and never
   come back: they show as "saved" and stay unchanged when left empty.
     connectionsHtml(st)              the Data tab's section (st = GET /workspaces/:id/data)
     connectSheet(o, st, provider)    the form; o = { id, data, onSaved() }
     pickProvider(anchor, o, st)      the "Connect" menu */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
var HOST = 'apparatus.name.ng';
var TIPS = {
  supabase: 'Supabase → Project Settings → API. Then in Authentication → URL Configuration, add your site link '
    + 'as a Redirect URL.',
  firebase: 'Firebase → Project settings → Your apps → Web app (you can paste the whole firebaseConfig). Then add '
    + HOST + ' under Authentication → Settings → Authorized domains.',
  appwrite: 'Appwrite → Settings for the endpoint and project ID. Add a Web platform with hostname ' + HOST + '.',
  pocketbase: 'The address of your PocketBase server. Allow ' + HOST + ' in its CORS settings if you set any.',
  clerk: 'Clerk → API keys → Publishable key (starts with pk_). Add your site link to the allowed origins.',
  github: 'A fine-grained token (github.com → Settings → Developer settings) for this repository with Contents and '
    + 'Pull requests: Read and write.',
  bitbucket: 'An Atlassian API token with your Atlassian email, or a repository access token (leave email empty), '
    + 'with repository write and pull request write.',
};
var GIT = { github: 1, bitbucket: 1 };

function provider(st, id) {
  return (st.providers || []).filter(function (p) { return p.id === id; })[0] || null;
}
function connected(st, id) {
  return (st.connections || []).filter(function (c) { return c.provider === id; })[0] || null;
}
function summary(c) {
  var v = c.config || {};
  return v.url || v.endpoint || v.authDomain || v.projectId || (v.publishableKey ? v.publishableKey.slice(0, 12)
    + '…' : '');
}

function connectionsHtml(st) {
  var list = (st.connections || []).filter(function (c) { return !GIT[c.provider]; });
  return '<section class="wk-dsec"><div class="wk-dhead"><h3>' + icon('users') + 'Sign-in &amp; services</h3>'
    + '<button type="button" class="btn sm" data-conn-add>' + icon('plus') + 'Connect</button></div>'
    + (list.length ? list.map(function (c) {
      var p = provider(st, c.provider);
      return '<div class="wk-row"><div class="px-row"><b>' + esc(p ? p.label : c.provider) + '</b><small>'
        + esc(summary(c)) + (c.server ? ' · Colon can edit' : '') + '</small></div><button class="icon-btn" '
        + 'type="button" data-conn="' + esc(c.provider)
        + '" aria-label="Options for ' + esc(p ? p.label : c.provider) + '">' + icon('more') + '</button></div>';
    }).join('') : '<p class="px-empty">Connect Supabase, Firebase, GitHub or another service. Colon builds login '
      + 'and accounts with it, works in your database and pushes your files.</p>') + '</section>';
}

// "apiKey: 'AIza…', authDomain: …" pasted from a firebaseConfig -> { apiKey, authDomain, … }
function parseConfig(text) {
  var out = {};
  String(text || '').replace(/["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g, function (all, k, v) {
    out[k] = v; return all;
  });
  return out;
}

function connectSheet(o, st, id) {
  var p = provider(st, id);
  if (!p) return;
  var cur = connected(st, id), v = (cur && cur.config) || {};
  C.sheet('<form class="px-sheet wk-dsheet" novalidate><h2 class="h3">' + (cur ? 'Edit ' : 'Connect ')
    + esc(p.label) + '</h2><p class="small muted">' + esc(TIPS[id] || '') + '</p>'
    + (id === 'firebase' ? '<label class="wk-f"><span>Paste firebaseConfig (optional)</span><textarea class="input" '
      + 'rows="3" data-paste spellcheck="false" placeholder="{ apiKey: …, authDomain: … }"></textarea></label>' : '')
    + p.fields.map(function (f) {
      return '<label class="wk-f"><span>' + esc(f.label) + '</span><input class="input" data-f="' + esc(f.name)
        + '" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="' + esc(f.hint || '')
        + '" value="' + esc(v[f.name] || '') + '"></label>';
    }).join('') + serverFields(p, cur)
    + '<small class="wk-bad" data-err aria-live="polite"></small><div class="sheet-actions">'
    + '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">'
    + (cur ? 'Save' : 'Connect') + '</button></div></form>', function (el, close) {
    var paste = el.querySelector('[data-paste]');
    if (paste) {
      paste.addEventListener('input', function () {
        var got = parseConfig(paste.value);
        el.querySelectorAll('[data-f]').forEach(function (i) {
          var k = i.getAttribute('data-f');
          if (got[k]) i.value = got[k];
        });
      });
    }
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {};
      el.querySelectorAll('[data-f]').forEach(function (i) { body[i.getAttribute('data-f')] = i.value.trim(); });
      var srv = {};
      el.querySelectorAll('[data-s]').forEach(function (i) { if (i.value.trim()) srv[i.getAttribute('data-s')] =
        i.value.trim(); });
      if (Object.keys(srv).length) body.server = srv;
      o.data.putWorkspaceConnection(o.id, id, body).then(function () {
        close(); C.toast(p.label + ' connected.', 'ok'); if (o.onSaved) o.onSaved();
      }).catch(function (err) {
        el.querySelector('[data-err]').textContent = err.message;
        var bad = err.field && el.querySelector('[data-f="' + err.field + '"],[data-s="' + err.field + '"]');
        if (bad) bad.focus();
      });
    });
  }, { label: 'Connect ' + p.label });
}

// v0.31.0: server-access fields (password inputs; a saved one shows as "saved" and is kept when left empty)
function serverFields(p, cur) {
  var list = p.server || [];
  if (!list.length) return '<p class="small muted">Only public settings go here; they end up in your site’s files.</p>';
  var git = p.kind === 'git';
  return '<h3 class="wk-f-h">' + (git ? 'Access' : 'Let Colon work in this database (optional)') + '</h3>'
    + list.map(function (f) {
      var saved = cur && cur.server;
      return '<label class="wk-f"><span>' + esc(f.label) + '</span>' + (f.multiline ? '<textarea class="input" '
        + 'rows="3" '
        + 'data-s="' + esc(f.name) + '" spellcheck="false" placeholder="' + esc(saved ? 'Saved. Paste to replace'
          : f.hint || '') + '"></textarea>' : '<input class="input" type="' + (f.secret === false ? 'text' : 'password')
        + '" data-s="' + esc(f.name) + '" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="'
        + esc(saved ? 'Saved. Type to replace' : f.hint || '') + '">') + '</label>';
    }).join('') + '<p class="small muted">' + (git ? 'Kept encrypted on Colon’s server and never shown again. Colon '
    + 'uses it to commit, push and merge for this workspace only.' : 'Kept encrypted on Colon’s server, never in your '
    + 'site’s files. Colon uses it to read and change this database when you ask in Chat.') + '</p>';
}

function pickProvider(anchor, o, st) {
  var items = [];
  [['auth', 'Sign-in & databases'], ['git', 'Git repositories']].forEach(function (g) {
    var list = (st.providers || []).filter(function (p) { return (p.kind === 'git' ? 'git' : 'auth') === g[0]; });
    if (!list.length) return;
    items.push({ head: g[1] });
    list.forEach(function (p) {
      items.push({ label: p.label + (connected(st, p.id) ? ' (connected)' : ''), icon: g[0] === 'git' ? 'code'
        : 'plus', onClick: function () { connectSheet(o, st, p.id); } });
    });
  });
  C.menu(anchor, items, { align: 'right', label: 'Connect a service' });
}

function connectionMenu(anchor, o, st, id) {
  var p = provider(st, id);
  C.menu(anchor, [{ label: 'Edit', icon: 'edit', onClick: function () { connectSheet(o, st, id); } }, '-',
    { label: 'Disconnect', icon: 'trash', danger: true, onClick: function () {
      C.confirm({ title: 'Disconnect ' + (p ? p.label : id) + '?', body: 'Your site’s files keep the settings '
        + 'they were built with; Colon stops using them for new builds.', confirm: 'Disconnect', danger: true })
        .then(function (yes) {
          if (yes) o.data.deleteWorkspaceConnection(o.id, id).then(o.onSaved).catch(function (e) {
            C.toast(e.message, 'bad'); });
        });
    } }], { align: 'right', label: 'Service options' });
}

export { connectionsHtml, connectSheet, pickProvider, connectionMenu, parseConfig };
