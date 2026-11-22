/* Colon AI · Workspace chat + menu (v0.27.3). Clone a repository (its website files replace the workspace's; the
   chat's Undo brings the old ones back), Learn from a repository (Colon follows its structure and style), and the
   workspace's standing instructions (sent with every build). chipsHtml(h) shows what is on above the chat box.
   openPlus(anchor, o) where o = { id, data, h (the chat history), onBusy(text|null), onDone() }. */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;

function short(u) { return String(u || '').replace(/^https?:\/\/(www\.)?(github\.com\/)?/, '').replace(/\.git$/, ''); }

function chipsHtml(h) {
  var out = '';
  if (h.instructions) {
    out += '<button type="button" class="wk-chip" data-ctx="instr">' + icon('edit') + '<span>Instructions on</span>'
      + '</button>';
  }
  if (h.reference) {
    out += '<span class="wk-chip">' + icon('book') + '<span>Learning from ' + esc(short(h.reference.url))
      + '</span><button type="button" data-ctx="forget" aria-label="Stop learning from this repository">'
      + icon('x') + '</button></span>';
  }
  return out;
}

function repoAction(o, action) {
  var clone = action === 'clone';
  C.prompt({ title: clone ? 'Clone a repository' : 'Learn from a repository', body: clone ? 'Its website files '
    + 'replace the files in this workspace. You can undo it from the chat.' : 'Colon reads its key files and '
    + 'follows its structure and style when it builds. Nothing is copied unless you ask.', label: 'Repository link',
  placeholder: 'https://github.com/owner/name', max: 500, confirm: clone ? 'Clone' : 'Learn' }).then(function (url) {
    if (!url) return;
    o.onBusy((clone ? 'Cloning ' : 'Reading ') + short(url) + '…');
    o.data.workspaceRepo(o.id, action, url).then(function () {
      o.onBusy(null);
      C.toast(clone ? 'Repository cloned.' : 'Colon learned from the repository.', 'ok');
      o.onDone();
    }).catch(function (e) { o.onBusy(null); C.toast(e.message, 'bad'); });
  });
}

function editInstructions(o) {
  var cur = (o.h && o.h.instructions) || '';
  C.sheet('<form class="px-sheet wk-instr" novalidate><h2 class="h3">Instructions</h2><p class="small muted">Colon '
    + 'follows these in every build of this site, like “Use Tailwind”, “Keep it in French” or “Dark theme, no '
    + 'images”.</p><textarea class="textarea" maxlength="4000" rows="6" data-t aria-label="Instructions">'
    + esc(cur) + '</textarea><div class="sheet-actions">' + (cur ? '<button type="button" class="btn ghost" '
    + 'data-clear>Clear</button>' : '<button type="button" class="btn ghost" data-close>Cancel</button>')
    + '<button class="btn primary" type="submit">Save</button></div></form>', function (el, close) {
    var t = el.querySelector('[data-t]');
    function save(v) {
      o.data.updateWorkspace(o.id, { instructions: v }).then(function () {
        close(); C.toast(v ? 'Instructions saved.' : 'Instructions cleared.', 'ok'); o.onDone();
      }).catch(function (e) { C.toast(e.message, 'bad'); });
    }
    setTimeout(function () { t.focus(); }, 60);
    el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); save(t.value.trim()); });
    var clr = el.querySelector('[data-clear]');
    if (clr) clr.addEventListener('click', function () { save(''); });
  }, { label: 'Instructions' });
}

function forget(o) {
  o.data.forgetWorkspaceReference(o.id).then(function () { C.toast('Colon stopped learning from it.', 'ok');
    o.onDone(); }).catch(function (e) { C.toast(e.message, 'bad'); });
}

function openPlus(anchor, o) {
  var h = o.h || {};
  var items = [{ label: 'Clone a repository', sub: 'Copy its site files here', icon: 'download',
    onClick: function () { repoAction(o, 'clone'); } },
  { label: 'Learn from a repository', sub: 'Colon follows its style', icon: 'book',
    onClick: function () { repoAction(o, 'learn'); } },
  { label: h.instructions ? 'Edit instructions' : 'Set instructions', sub: 'Rules for every build', icon: 'edit',
    onClick: function () { editInstructions(o); } }];
  if (h.reference) {
    items.push('-', { label: 'Stop learning from ' + short(h.reference.url), icon: 'x',
      onClick: function () { forget(o); } });
  }
  C.menu(anchor, items, { label: 'Add to chat' });
}

export { chipsHtml, openPlus, editInstructions, forget };
