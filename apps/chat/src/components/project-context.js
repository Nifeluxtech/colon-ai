/* Colon AI · a project's Context sheet (v0.24.0): what Colon reads in every chat of the project.
     Upload files   notes, PDFs, code or a .zip project (the existing uploads, saved to the project)
     Connect GitHub · GitLab · Bitbucket   a read-only access token (stored encrypted, never shown again), then pick
                    the repository (or type owner/name) and the branch; private repositories work
     Any Git URL    a public https address, with an optional token
   A connected repository shows "Synced <time> · <sha7>" with Sync (pull the latest commit) and Disconnect (deletes
   the token and the stored copy). Developer mode reads the repository in every session of the project. */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { fileRow, rel } from './project-ui.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;
var NAMES = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', git: 'Git URL' };
var HELP = {
  github: 'Use a fine-grained personal access token with read-only access to Contents for the repositories you '
    + 'pick (a classic token needs the repo scope for private ones). Public repositories need no token.',
  gitlab: 'Use a personal or project access token with the read_api and read_repository scopes. Public projects '
    + 'need no token.',
  bitbucket: 'Use a repository or workspace access token with Repositories: Read, or your user name and an app '
    + 'password as user:app-password.',
  git: 'Any public https Git address, like https://codeberg.org/owner/repo.git. Add a token only for a private one.',
};

function fail(e) { C.toast(e.message, 'bad'); }

/** openContext(project, files, reload) opens the sheet; reload() refreshes the project page behind it. */
function openContext(p, files, reload) {
  var data = CW.data, repo = p.repo, own = (files || []).filter(function (f) { return !f.repo; });
  C.sheet('<div class="px-sheet px-ctx"></div>', function (el, close) {
    var box = el.querySelector('.px-ctx');
    function refresh() { return reload().then(function () { close(); }); }
    function home() {
      box.innerHTML = '<h2 class="h3">Context</h2><p class="small muted">Files and code Colon reads in every chat '
        + 'in this project.</p>' + (repo ? repoBox(repo) : '') + '<div class="px-opts">'
        + '<label class="px-opt">' + icon('upload') + '<span><b>Upload files</b><small>Notes, PDFs, code or a .zip '
        + 'project</small></span><input type="file" multiple hidden data-up></label>'
        + opt('github', 'Connect GitHub', 'Personal access token, read-only')
        + opt('gitlab', 'GitLab', 'Access token') + opt('bitbucket', 'Bitbucket', 'Access token or app password')
        + opt('git', 'Any Git URL', 'Public https address, token optional') + '</div>'
        + (own.length ? '<h3 class="px-h">Files</h3><div class="px-files">' + own.map(fileRow).join('') + '</div>'
          : '');
      box.querySelector('[data-up]').addEventListener('change', function (e) {
        upload([].slice.call(e.target.files)); });
      box.querySelectorAll('[data-prov]').forEach(function (b) { b.addEventListener('click', function () {
        connectView(b.getAttribute('data-prov')); }); });
      box.querySelectorAll('[data-fdel]').forEach(function (b) { b.addEventListener('click', function () {
        data.removeUpload(b.getAttribute('data-fdel')).then(refresh).catch(fail); }); });
      var sync = box.querySelector('[data-sync]');
      if (sync) sync.addEventListener('click', function () {
        sync.disabled = true; sync.textContent = 'Syncing…';
        data.syncRepo(p.id).then(function (d) { C.toast(d.unchanged ? 'Already up to date.' : 'Synced '
          + d.repo.sha7 + '.', 'ok'); refresh(); }).catch(function (e) { fail(e); home(); });
      });
      var off = box.querySelector('[data-unlink]');
      if (off) off.addEventListener('click', function () {
        C.confirm({ title: 'Disconnect ' + repo.owner + '/' + repo.name + '?', body: 'Colon deletes its stored copy '
          + 'and your access token. Chats in this project stay.', confirm: 'Disconnect', danger: true })
          .then(function (ok) { if (ok) data.disconnectRepo(p.id).then(refresh).catch(fail); });
      });
    }
    function upload(list) {
      if (!list.length) return;
      C.toast('Uploading ' + (list.length === 1 ? list[0].name : list.length + ' files') + '…');
      list.reduce(function (chain, f) {
        return chain.then(function () { return data.upload(f, { projectId: p.id }); }); }, Promise.resolve())
        .then(function () { C.toast('Added to the project.', 'ok'); refresh(); }).catch(fail);
    }
    function connectView(prov) {
      var git = prov === 'git';
      box.innerHTML = '<button class="px-back" type="button" data-home>' + icon('left') + 'Context</button>'
        + '<h2 class="h3">' + (git ? 'Any Git URL' : 'Connect ' + NAMES[prov]) + '</h2><p class="small muted">'
        + esc(HELP[prov]) + '</p><form class="px-form" novalidate autocomplete="off">'
        + (git ? field('url', 'Repository address', 'https://…/owner/repo.git', 'url') : '')
        + field('token', git ? 'Access token (optional)' : 'Access token', git ? 'Only for a private repository'
          : 'Paste the token', 'password')
        + (git ? '' : '<div class="px-row2">' + field('repo', 'Repository', 'owner/name or its address', 'text')
          + '<button class="btn sm" type="button" data-find>Find mine</button></div><datalist id="px-repos">'
          + '</datalist>')
        + field('branch', 'Branch', 'Default branch', 'text') + '<datalist id="px-branches"></datalist>'
        + '<p class="tiny muted">' + icon('lock') + 'Read-only. The token is stored encrypted and never shown '
        + 'again.</p><div class="sheet-actions"><button class="btn primary block" type="submit">Connect</button>'
        + '</div></form>';
      var f = box.querySelector('form'), val = function (n) { var i = f.querySelector('[name=' + n + ']');
        return i ? i.value.trim() : ''; };
      var repoIn = f.querySelector('[name=repo]'), branchIn = f.querySelector('[name=branch]');
      if (repoIn) repoIn.setAttribute('list', 'px-repos');
      branchIn.setAttribute('list', 'px-branches');
      box.querySelector('[data-home]').addEventListener('click', home);
      var body = function () { return { provider: prov, url: git || /^https?:/i.test(val('repo')) ? val(git ? 'url'
        : 'repo') : undefined, repo: !git && !/^https?:/i.test(val('repo')) ? val('repo') : undefined,
      token: val('token') || undefined, branch: val('branch') || undefined }; };
      var find = f.querySelector('[data-find]');
      if (find) find.addEventListener('click', function () {
        data.repoList(p.id, { provider: prov, token: val('token') || undefined }).then(function (d) {
          box.querySelector('#px-repos').innerHTML = d.repos.map(function (r) { return '<option value="'
            + esc(r.repo) + '">' + (r.private ? 'Private' : 'Public') + '</option>'; }).join('');
          C.toast(d.repos.length + ' repositories found. Start typing to pick one.', 'ok'); repoIn.focus();
        }).catch(fail);
      });
      var lastRepo = '';
      (repoIn || f.querySelector('[name=url]')).addEventListener('change', function () {
        var b = body(); if (!(b.repo || b.url) || (b.repo || b.url) === lastRepo) return;
        lastRepo = b.repo || b.url;
        data.repoBranches(p.id, b).then(function (d) {
          box.querySelector('#px-branches').innerHTML = d.branches.map(function (x) { return '<option value="'
            + esc(x) + '">'; }).join('');
          if (!branchIn.value && d.default_branch) branchIn.placeholder = 'Default: ' + d.default_branch;
        }).catch(function () { /* the branch stays free text */ });
      });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Importing… this can take '
          + 'a minute';
        data.connectRepo(p.id, body()).then(function (d) {
          C.toast('Connected ' + d.repo.owner + '/' + d.repo.name + ' · ' + d.repo.sha7, 'ok'); refresh();
        }).catch(function (x) { btn.disabled = false; btn.textContent = 'Connect'; fail(x); });
      });
    }
    home();
  }, { label: 'Project context', cls: 'px-sheet-wrap' });
}

function opt(prov, title, sub) {
  return '<button class="px-opt" type="button" data-prov="' + prov + '">' + icon(prov === 'git' ? 'link' : 'code')
    + '<span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' + icon('right') + '</button>';
}
function field(name, label, ph, type) {
  return '<label class="px-field"><span>' + esc(label) + '</span><input class="input" name="' + name + '" type="'
    + type + '" placeholder="' + esc(ph) + '" spellcheck="false" autocapitalize="off" autocomplete="'
    + (type === 'password' ? 'new-password' : 'off') + '"></label>';
}
function repoBox(r) {
  return '<div class="px-repo"><div class="px-repo-h">' + icon('code') + '<span><b>' + esc(r.owner + '/' + r.name)
    + '</b><small>' + esc(NAMES[r.provider] || r.provider) + ' · ' + esc(r.branch || '') + (r.files != null ? ' · '
    + r.files + ' files' : '') + '</small></span></div><p class="px-repo-sync">' + esc(r.synced_at ? 'Synced '
    + rel(r.synced_at) : 'Not synced yet') + (r.sha7 ? ' · <code>' + esc(r.sha7) + '</code>' : '') + '</p>'
    + '<div class="px-repo-acts"><button class="btn sm" type="button" data-sync>' + icon('refresh') + 'Sync</button>'
    + '<button class="btn sm ghost" type="button" data-unlink>Disconnect</button></div></div>';
}

export { openContext };
