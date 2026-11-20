/* Colon AI · Projects markup (v0.20.0): project cards, the colour each project keeps, the empty state, loading
   skeletons and the titled panels of a project's page. Pure HTML builders; pages/projects.js binds the events. */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;

// One stable accent per project, picked from its id so it never changes between visits.
var HUES = ['#4169E1', '#0EA5E9', '#8B5CF6', '#14B8A6', '#F59E0B', '#EC4899', '#22C55E', '#F97316'];
function hue(id) {
  var h = 0, s = String(id || '');
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

function cardHtml(p) {
  var desc = (p.instructions || '').replace(/\s+/g, ' ').trim();
  return '<div class="pj-card" style="--pj:' + hue(p.id) + '"><a class="pj-main" href="#/p/' + encodeURIComponent(p.id)
    + '"><span class="pj-top"><span class="pj-ico">' + icon('folder') + '</span><time class="pj-time">'
    + esc(C.ago(p.updated_at)) + '</time></span><b class="pj-name">' + esc(p.name) + '</b><span class="pj-desc'
    + (desc ? '' : ' none') + '">' + esc(desc || 'No instructions yet') + '</span><span class="pj-stats"><span>'
    + icon('chat') + plural(p.chats, 'chat') + '</span><span>' + icon('file') + plural(p.files, 'file')
    + '</span></span></a><button class="icon-btn sm pj-more" type="button" data-pmenu="' + esc(p.id)
    + '" aria-label="Options for ' + esc(p.name) + '" aria-haspopup="menu">' + icon('more') + '</button></div>';
}

function skeletonHtml(n) {
  var one = '<div class="pj-card pj-skel" aria-hidden="true"><div class="pj-main"><span class="skel pj-s-ico"></span>'
    + '<span class="skel pj-s-l1"></span><span class="skel pj-s-l2"></span><span class="skel pj-s-l3"></span>'
    + '</div></div>';
  return '<div class="pj-grid" aria-busy="true">' + new Array(n + 1).join(one) + '</div>';
}

// Inline illustration: stacked folders with a spark, drawn in the theme's colours.
var ART = '<svg class="pj-art" viewBox="0 0 160 120" aria-hidden="true" fill="none">'
  + '<ellipse cx="80" cy="106" rx="56" ry="7" fill="currentColor" opacity=".08"/>'
  + '<rect x="30" y="34" width="92" height="62" rx="12" fill="var(--primary-soft)" stroke="var(--primary-line)"/>'
  + '<path d="M38 30h26l8 9h44a8 8 0 0 1 8 8v45a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z" '
  + 'fill="var(--elev-3)" stroke="var(--line-2)"/>'
  + '<rect x="46" y="58" width="52" height="6" rx="3" fill="var(--line-2)"/>'
  + '<rect x="46" y="71" width="34" height="6" rx="3" fill="var(--line)"/>'
  + '<circle cx="118" cy="30" r="14" fill="var(--primary)"/>'
  + '<path d="M118 22v16M110 30h16" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
  + '<path d="M138 52l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="var(--cyan)"/>'
  + '<path d="M22 22l1.5 3.5 3.5 1.5-3.5 1.5L22 32l-1.5-3.5L17 27l3.5-1.5z" fill="var(--cyan)" opacity=".7"/></svg>';

function emptyHtml() {
  return '<div class="pj-empty">' + ART + '<h2 class="h2">Start your first project</h2><p>Keep the chats, files and '
    + 'instructions for a course, a business or a trip together. Colon follows the project’s instructions in every '
    + 'chat inside it.</p><button class="btn primary" type="button" data-new>' + icon('plus') + 'New project</button>'
    + '<ul class="pj-ideas"><li>' + icon('book') + 'Final year thesis</li><li>' + icon('lightning') + 'Side business'
    + '</li><li>' + icon('target') + 'Exam prep</li></ul></div>';
}

function usageHtml(lim) {
  if (!lim || lim.limit == null) return '';
  var pct = Math.min(100, Math.round((lim.used / Math.max(1, lim.limit)) * 100));
  return '<div class="pj-usage' + (lim.used >= lim.limit ? ' full' : '') + '"><span>' + lim.used + ' of ' + lim.limit
    + ' projects · ' + esc(lim.plan || 'current') + ' plan</span><span class="meter"><i style="width:' + pct
    + '%"></i></span><a class="link" href="#/account/plan">Plans</a></div>';
}

// A titled panel on a project's page: heading, optional count and action, then the body.
function panel(ic, title, opts, body) {
  opts = opts || {};
  return '<section class="pj-panel' + (opts.cls ? ' ' + opts.cls : '') + '"><header class="pj-panel-h"><span '
    + 'class="pj-panel-ico">' + icon(ic) + '</span><div class="pj-panel-t"><h2>' + esc(title)
    + (opts.count != null ? '<span class="pj-n">' + opts.count + '</span>' : '') + '</h2>'
    + (opts.sub ? '<p>' + esc(opts.sub) + '</p>' : '') + '</div>' + (opts.action || '') + '</header>' + body
    + '</section>';
}

function chatRow(c) {
  return '<a class="pj-row" href="#/c/' + encodeURIComponent(c.id) + '"><span class="pj-row-ico">' + icon('chat')
    + '</span><span class="pj-row-b"><b>' + esc(c.title) + '</b><small>' + esc(c.preview || 'No messages yet')
    + '</small></span><time>' + esc(C.ago(c.updated_at)) + '</time></a>';
}
function fileRow(f) {
  var ext = (String(f.name).split('.').pop() || '').slice(0, 4).toUpperCase();
  return '<div class="pj-row"><span class="pj-row-ico file">' + (ext ? '<i>' + esc(ext) + '</i>' : icon('file'))
    + '</span><span class="pj-row-b"><b>' + esc(f.name) + '</b><small>' + esc(C.fmtBytes(f.size))
    + '</small></span><button class="icon-btn sm" type="button" data-fdel="' + esc(f.id) + '" aria-label="Delete '
    + esc(f.name) + '">' + icon('trash') + '</button></div>';
}
function memRow(m) {
  return '<div class="pj-row"><span class="pj-row-ico">' + icon('bookmark') + '</span><span class="pj-row-b wrap">'
    + esc(m.content) + '</span><button class="icon-btn sm" type="button" data-mdel="' + esc(m.id)
    + '" aria-label="Delete memory">' + icon('trash') + '</button></div>';
}
function note(text, extra) { return '<div class="pj-note">' + text + (extra || '') + '</div>'; }

export { cardHtml, chatRow, emptyHtml, fileRow, hue, memRow, note, panel, plural, skeletonHtml, usageHtml };
