/* Colon AI · Projects markup (v0.24.0, Claude-app-style redesign): the list's plain rows, a project's header, its
   Context and Custom instructions cards, the Memory row and its sessions, and the floating pill button. Pure HTML
   builders; pages/projects.js binds the events and components/project-context.js the Context sheet. */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;

// "just now", "5 minutes ago", "yesterday", "3 days ago", then the date.
function rel(d) {
  var s = (Date.now() - new Date(d).getTime()) / 1000;
  if (!(s >= 0)) return 'just now';
  if (s < 60) return 'just now';
  var n = function (v, w) { v = Math.floor(v); return v + ' ' + w + (v === 1 ? '' : 's') + ' ago'; };
  if (s < 3600) return n(s / 60, 'minute');
  if (s < 86400) return n(s / 3600, 'hour');
  if (s < 172800) return 'yesterday';
  if (s < 2592000) return n(s / 86400, 'day');
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

// Files that make a project a code project (new sessions open in Developer mode).
var CODE = new RegExp('\\.(js|mjs|cjs|jsx|ts|tsx|py|php|rb|java|kt|swift|dart|go|rs|c|h|cpp|hpp|cs|vue|svelte|'
  + 'sql|sh|html|css|scss)$', 'i');
function isCodeProject(p, files) {
  return Boolean(p.repo) || (files || []).some(function (f) { return f.format === 'zip' || CODE.test(f.name); });
}

/* ---------- List ---------- */
function bar(left, title, right) {
  return '<header class="px-bar">' + left + '<h1 class="px-bar-t">' + esc(title) + '</h1>' + right + '</header>';
}
function rowHtml(p) {
  return '<a class="px-row" role="listitem" href="#/p/' + encodeURIComponent(p.id) + '"><b>' + esc(p.name)
    + '</b><small>Edited ' + esc(rel(p.updated_at)) + (p.archived ? ' · Archived' : '') + '</small></a>';
}
function fab(attr, label) {
  return '<div class="px-fab-wrap"><button class="px-fab" type="button" ' + attr + '>' + icon('plus') + esc(label)
    + '</button></div>';
}
function skeletonHtml(n) {
  return new Array(n + 1).join('<div class="px-row px-skel" aria-hidden="true"><span class="skel"></span><span '
    + 'class="skel"></span></div>');
}

/* ---------- One project ---------- */
function contextSub(p, files) {
  var own = (files || []).filter(function (f) { return !f.repo; }).length;
  var bits = [];
  if (own) bits.push(plural(own, 'file'));
  if (p.repo) bits.push('1 repo');
  return bits.join(' · ');
}
function repoLine(r) {
  if (!r) return '';
  return '<span class="px-repo-line">' + icon('code') + esc(r.owner + '/' + r.name) + '<small>'
    + esc(r.synced_at ? 'Synced ' + rel(r.synced_at) : 'Not synced yet') + (r.sha7 ? ' · ' + esc(r.sha7) : '')
    + '</small></span>';
}
function cardsHtml(p, files) {
  var sub = contextSub(p, files);
  var first = (p.instructions || '').split('\n').filter(function (l) { return l.trim(); })[0] || '';
  return '<div class="px-cards"><button class="px-card" type="button" data-ctx><b>Context</b>'
    + (sub ? '<span class="px-card-sub">' + esc(sub) + '</span>' : '') + repoLine(p.repo)
    + '<span class="px-link">' + (sub ? 'Manage' : 'Add files') + '</span></button>'
    + '<button class="px-card" type="button" data-inst><b>Custom instructions</b>'
    + (first ? '<span class="px-card-sub clamp">' + esc(first) + '</span>' : '')
    + '<span class="px-link">' + (first ? 'Edit' : 'Add instructions') + '</span></button></div>';
}
function memoryRow(count) {
  return '<button class="px-mem" type="button" data-mem>' + icon('bookmark') + '<span><b>Memory</b><small>'
    + (count ? count + (count === 1 ? ' project memory' : ' project memories') : 'Only this project’s memories')
    + '</small></span>' + icon('right') + '</button>';
}
function sessionRow(c) {
  return '<a class="px-session" href="#/c/' + encodeURIComponent(c.id) + '">' + icon('chat') + '<b>'
    + esc(c.title || 'New chat') + '</b><time>' + esc(rel(c.updated_at)) + '</time></a>';
}
function memRow(m) {
  return '<div class="px-memrow"><span>' + esc(m.content) + '</span><button class="icon-btn sm" type="button" '
    + 'data-mdel="' + esc(m.id) + '" aria-label="Delete memory">' + icon('trash') + '</button></div>';
}
function fileRow(f) {
  var ext = (String(f.name).split('.').pop() || '').slice(0, 4).toUpperCase();
  return '<div class="px-file"><span class="px-file-ico">' + (ext ? esc(ext) : icon('file')) + '</span><span '
    + 'class="px-file-b"><b>' + esc(f.name) + '</b><small>' + esc(C.fmtBytes(f.size)) + '</small></span><button '
    + 'class="icon-btn sm" type="button" data-fdel="' + esc(f.id) + '" aria-label="Remove ' + esc(f.name) + '">'
    + icon('trash') + '</button></div>';
}

export { bar, cardsHtml, fab, fileRow, isCodeProject, memRow, memoryRow, plural, rel, repoLine, rowHtml,
  sessionRow, skeletonHtml };
