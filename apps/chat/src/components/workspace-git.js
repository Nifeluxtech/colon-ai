/* Colon AI · Workspace Git (v0.31.0): a GitHub or Bitbucket repository connected to the workspace (Data tab ->
   Connect). Colon commits the workspace's files to it (a folder in the repo, or its root), opens pull requests and
   merges them; the chat can do the same ("commit and push", "merge the PR"). Shown as a card per repository:
   last commit, Commit & push, Pull request, Merge, and the open pull requests with a Merge button each.
     gitHtml(st)             the cards (st = GET /workspaces/:id/data)
     bindGit(el, o, st)      wires them; o = { id, data, onSaved() } */
import { Colon } from '../../../../packages/ui/js/colon.js';
import * as UI from './project-ui.js';

var C = Colon, icon = C.icon, esc = C.esc;
var GIT = { github: 'GitHub', bitbucket: 'Bitbucket' };

function gits(st) { return (st.connections || []).filter(function (c) { return GIT[c.provider]; }); }
function card(c) {
  var v = c.config || {}, last = (c.state || {}).last;
  return '<div class="wk-git" data-git="' + esc(c.provider) + '"><div class="wk-git-h">' + icon('code') + '<span><b>'
    + esc(v.repo || '') + '</b><small>' + esc(GIT[c.provider]) + ' · ' + esc(v.branch || 'main') + (v.folder ? ' · '
    + esc(v.folder) + '/' : '') + (c.server ? ' · can push' : ' · token missing')
    + '</small></span><button class="icon-btn" type="button" data-conn="' + esc(c.provider)
    + '" aria-label="Options for '
    + esc(GIT[c.provider]) + '">' + icon('more') + '</button></div>' + (last ? '<a class="wk-git-last" href="'
    + esc(last.url || '#') + '" target="_blank" rel="noopener"><code>' + esc(String(last.sha || '').slice(0, 7))
    + '</code><span>' + esc(last.message || '') + '</span><small>' + esc(UI.rel(last.at)) + '</small></a>'
    : '<p class="wk-note">Nothing pushed yet. Commit & push sends every file in this workspace.</p>')
    + '<div class="wk-git-acts"><button type="button" class="btn sm primary" data-g="commit">' + icon('upload')
    + 'Push</button><button type="button" class="btn sm" data-g="pr">' + icon('split') + 'PR</button><button '
    + 'type="button" class="btn sm" data-g="merge">' + icon('check') + 'Merge</button></div><div data-pulls></div>'
    + '</div>';
}
function gitHtml(st) {
  var list = gits(st);
  if (!list.length) return '';
  return '<section class="wk-dsec"><div class="wk-dhead"><h3>' + icon('code') + 'Git</h3></div>'
    + list.map(card).join('') + '</section>';
}

function commitSheet(o, c) {
  var v = c.config || {};
  C.sheet('<form class="px-sheet wk-dsheet" novalidate><h2 class="h3">Commit &amp; push</h2><p class="small muted">'
    + 'Every file in this workspace goes to ' + esc(v.repo) + (v.folder ? ' (' + esc(v.folder) + '/)' : '')
    + '. Files you deleted here since the last push are deleted there too.</p><label class="wk-f"><span>Message'
    + '</span><input class="input" data-m maxlength="200" value="Update site from Colon"></label><label class="wk-f">'
    + '<span>Branch</span><input class="input" data-b maxlength="100" autocapitalize="off" value="' + esc(v.branch
      || 'main') + '"><small class="muted">A new branch name creates it from ' + esc(v.branch || 'main')
    + '.</small></label><small class="wk-bad" data-err aria-live="polite"></small><div class="sheet-actions">'
    + '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">'
    + 'Commit &amp; push</button></div></form>', function (el, close) {
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = el.querySelector('[type=submit]'); btn.disabled = true;
      o.data.workspaceGit(o.id, c.provider, 'commit', { message: el.querySelector('[data-m]').value.trim(),
        branch: el.querySelector('[data-b]').value.trim() }).then(function (r) {
        close(); C.toast('Pushed ' + UI.plural(r.files || 0, 'file') + ' (' + String(r.sha).slice(0, 7) + ').', 'ok');
        if (o.onSaved) o.onSaved();
      }).catch(function (err) { btn.disabled = false; el.querySelector('[data-err]').textContent = err.message; });
    });
  }, { label: 'Commit and push' });
}
function branchSheet(o, c, kind) {
  var v = c.config || {}, pr = kind === 'pr';
  C.sheet('<form class="px-sheet wk-dsheet" novalidate><h2 class="h3">' + (pr ? 'Open a pull request'
    : 'Merge a branch')
    + '</h2><label class="wk-f"><span>From branch</span><input class="input" data-h autocapitalize="off" '
    + 'placeholder="colon-update"></label><label class="wk-f"><span>Into branch</span><input class="input" data-base '
    + 'autocapitalize="off" value="' + esc(v.branch || 'main') + '"></label>' + (pr ? '<label class="wk-f"><span>Title'
      + '</span><input class="input" data-title maxlength="200" value="Update from Colon"></label>' : '')
    + '<small class="wk-bad" data-err aria-live="polite"></small><div class="sheet-actions"><button type="button" '
    + 'class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">' + (pr ? 'Open PR'
      : 'Merge') + '</button></div></form>', function (el, close) {
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var b = { head: el.querySelector('[data-h]').value.trim(), base: el.querySelector('[data-base]').value.trim() };
      if (pr) b.title = el.querySelector('[data-title]').value.trim();
      o.data.workspaceGit(o.id, c.provider, pr ? 'pulls' : 'merge', b).then(function (r) {
        close(); C.toast(pr ? 'Pull request #' + r.number + ' opened.' : 'Merged ' + b.head + ' into ' + b.base + '.',
          'ok'); if (o.onSaved) o.onSaved();
      }).catch(function (err) { el.querySelector('[data-err]').textContent = err.message; });
    });
  }, { label: pr ? 'Open a pull request' : 'Merge a branch' });
}
function pulls(box, o, c) {
  o.data.workspaceGitPulls(o.id, c.provider).then(function (d) {
    if (!box.isConnected) return;
    box.innerHTML = (d.pulls || []).map(function (p) {
      return '<div class="wk-pr"><span><b>#' + p.number + ' ' + esc(p.title) + '</b><small>' + esc(p.head) + ' → '
        + esc(p.base) + '</small></span><button type="button" class="btn sm" data-merge="' + p.number + '">Merge'
        + '</button></div>';
    }).join('');
    box.querySelectorAll('[data-merge]').forEach(function (b) { b.addEventListener('click', function () {
      var n = Number(b.getAttribute('data-merge'));
      C.confirm({ title: 'Merge pull request #' + n + '?', confirm: 'Merge' }).then(function (ok) {
        if (ok) o.data.workspaceGit(o.id, c.provider, 'merge', { number: n }).then(function () {
          C.toast('Merged #' + n + '.', 'ok'); pulls(box, o, c); }).catch(function (e) { C.toast(e.message, 'bad'); });
      });
    }); });
  }).catch(function () {});
}
function bindGit(el, o, st) {
  gits(st).forEach(function (c) {
    var box = el.querySelector('[data-git="' + c.provider + '"]');
    if (!box) return;
    box.querySelectorAll('[data-g]').forEach(function (b) { b.addEventListener('click', function () {
      var g = b.getAttribute('data-g');
      if (g === 'commit') commitSheet(o, c); else branchSheet(o, c, g);
    }); });
    if (c.server) pulls(box.querySelector('[data-pulls]'), o, c);
  });
}

export { gitHtml, bindGit, GIT };
