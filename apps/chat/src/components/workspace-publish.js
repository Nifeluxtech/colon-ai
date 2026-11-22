/* Colon AI · Workspace Publish tab (v0.28.0, Workspace step 4; plan: docs/workspace/plan.md). Puts the workspace's
   current files live at https://apparatus.name.ng/<name>/: pick a name (checked as you type), Publish, then
   Republish after changes or Take down. mount(el, o) where o = { id, data, workspace, files, onChanged() }. */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
var HOST = 'apparatus.name.ng/';

function suggest(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
    .replace(/-+$/, '') || 'my-site';
}
function when(at) {
  if (!at) return '';
  var d = new Date(at);
  return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function mount(el, o) {
  var w = o.workspace, pub = w.published, busy = false, seq = 0;
  var stale = pub && Number(w.version) > Number(pub.version);
  var hasIndex = (o.files || []).some(function (f) { return f.path === 'index.html'; });
  var url = pub ? 'https://' + HOST + pub.name + '/' : '';
  el.innerHTML = '<div class="wk-publish">'
    + (pub ? '<div class="wk-pub"><small>LIVE AT</small><a class="wk-pub-url" href="' + esc(url) + '" target="_blank"'
      + ' rel="noopener">' + esc(HOST + pub.name + '/') + '</a><span class="px-badge' + (stale ? ' wk-stale' : '')
      + '">' + (stale ? 'Changes not live yet' : 'Live') + '</span><small class="wk-pub-at">Version ' + esc(pub.version)
      + (when(pub.at) ? ' · ' + esc(when(pub.at)) : '') + '</small><div class="wk-pub-acts">'
      + '<a class="btn sm" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('external') + 'Open</a>'
      + '<button type="button" class="btn sm" data-copy>' + icon('copy') + 'Copy link</button></div></div>' : '')
    + '<label class="wk-pub-name"><span>' + (pub ? 'Address' : 'Choose your site’s address') + '</span>'
    + '<span class="wk-pub-in"><em>' + esc(HOST) + '</em><input data-name maxlength="30" autocapitalize="off" '
    + 'autocomplete="off" spellcheck="false" aria-describedby="wk-pub-msg" value="' + esc(pub ? pub.name
      : suggest(w.title)) + '"><em>/</em></span><small id="wk-pub-msg" data-msg aria-live="polite"></small></label>'
    + (hasIndex ? '' : '<p class="wk-pub-warn">' + icon('alert') + 'Add an index.html first: it’s the page people '
      + 'see at your link.</p>')
    + '<button type="button" class="btn primary wk-pub-go" data-go' + (hasIndex ? '' : ' disabled') + '>'
    + icon('globe') + (pub ? 'Republish' : 'Publish') + '</button>'
    + (pub ? '<button type="button" class="btn ghost wk-pub-down" data-down>' + icon('trash') + 'Take down</button>'
      : '')
    + '<p class="wk-pub-note">Sites are public. Only static files go live (HTML, CSS, JavaScript, images), with a '
    + 'small “Made with Colon” badge.</p></div>';
  var input = el.querySelector('[data-name]'), msg = el.querySelector('[data-msg]');
  var go = el.querySelector('[data-go]'), ok = true;

  function say(text, bad) { msg.textContent = text || ''; msg.className = bad ? 'wk-bad' : 'wk-ok'; }
  var check = C.debounce(function () {
    var name = input.value.trim().toLowerCase(), mine = ++seq;
    if (pub && name === pub.name) { ok = true; say(''); go.disabled = !hasIndex; return; }
    o.data.checkWorkspacePublish(o.id, name).then(function (r) {
      if (mine !== seq) return;
      ok = r.ok; say(r.ok ? 'Available' : r.reason, !r.ok); go.disabled = busy || !r.ok || !hasIndex;
    }).catch(function (e) { if (mine === seq) say(e.message, true); });
  }, 350);
  input.addEventListener('input', function () {
    var v = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (v !== input.value) input.value = v;
    go.disabled = true; say('Checking…'); check();
  });
  if (!pub) check();

  go.addEventListener('click', function () {
    if (busy || !ok) return;
    busy = true; go.disabled = true; go.lastChild.textContent = pub ? 'Republishing…' : 'Publishing…';
    o.data.publishWorkspace(o.id, input.value.trim()).then(function (r) {
      C.toast('Live at ' + HOST + r.name + '/', 'ok', { label: 'Open', fn: function () {
        window.open(r.url, '_blank', 'noopener'); } });
      o.onChanged();
    }).catch(function (e) {
      busy = false; go.disabled = false; go.lastChild.textContent = pub ? 'Republish' : 'Publish';
      if (e.field === 'name' || e.code === 'invalid') say(e.message, true); else C.toast(e.message, 'bad');
    });
  });
  var copy = el.querySelector('[data-copy]');
  if (copy) {
    copy.addEventListener('click', function () {
      C.copyText(url).then(function () { C.toast('Link copied.', 'ok'); });
    });
  }
  var down = el.querySelector('[data-down]');
  if (down) {
    down.addEventListener('click', function () {
      C.confirm({ title: 'Take this site down?', body: HOST + pub.name + '/ stops working. Your files stay here, '
        + 'and you can publish again any time.', confirm: 'Take down', danger: true }).then(function (yes) {
        if (!yes) return;
        o.data.unpublishWorkspace(o.id).then(function () { C.toast('Site taken down.', 'ok'); o.onChanged(); })
          .catch(function (e) { C.toast(e.message, 'bad'); });
      });
    });
  }
  return {};
}

export { mount };
