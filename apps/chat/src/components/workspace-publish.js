/* Colon AI · Workspace Publish tab (v0.28.0, Workspace step 4; plan: docs/workspace/plan.md). Puts the workspace's
   current files live: pick a name (checked as you type), Publish, then Republish after changes or Take down.
   v0.30.0: links are https://apparatus.name.ng/<username>/<site>/, so a site name only has to be free among the
   user's own sites. The username is picked once, here, on the first publish (and can be changed later; every
   site link follows). Sites published before v0.30.0 at /<site>/ forward to the new link on republish.
   mount(el, o) where o = { id, data, workspace, files, onChanged() }. */
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
function nameField(attr, label, pre, value, post, msg) {
  return '<label class="wk-pub-name"><span>' + label + '</span><span class="wk-pub-in"><em data-pre-' + attr + '>'
    + esc(pre) + '</em><input data-' + attr + ' maxlength="30" autocapitalize="off" autocomplete="off" '
    + 'spellcheck="false" aria-describedby="wk-msg-' + attr + '" value="' + esc(value) + '"><em>' + post + '</em>'
    + '</span><small id="wk-msg-' + attr + '" data-msg-' + attr + ' aria-live="polite">' + esc(msg || '')
    + '</small></label>';
}
function clean(input) {
  var v = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (v !== input.value) input.value = v;
  return v.trim();
}

function mount(el, o) {
  el.innerHTML = '<div class="wk-publish"><div class="skel px-skel-c"></div></div>';
  o.data.workspaceOwner().then(function (r) { if (el.isConnected) draw(el, o, r.name || ''); })
    .catch(function (e) { el.firstChild.innerHTML = '<p class="px-empty">' + esc(e.message) + '</p>'; });
  return {};
}

function draw(el, o, owner) {
  var w = o.workspace, pub = w.published, busy = false, seq = { site: 0, user: 0 }, ok = { site: true, user: true };
  var stale = pub && Number(w.version) > Number(pub.version);
  var hasIndex = (o.files || []).some(function (f) { return f.path === 'index.html'; });
  var url = pub ? pub.url || 'https://' + HOST + pub.name + '/' : '';
  var askUser = !owner;
  el.innerHTML = '<div class="wk-publish">'
    + (pub ? '<div class="wk-pub"><small>LIVE AT</small><a class="wk-pub-url" href="' + esc(url) + '" target="_blank"'
      + ' rel="noopener">' + esc(url.replace(/^https:\/\//, '')) + '</a><span class="px-badge' + (stale ? ' wk-stale'
        : '') + '">' + (stale ? 'Changes not live yet' : 'Live') + '</span><small class="wk-pub-at">Version '
      + esc(pub.version) + (when(pub.at) ? ' · ' + esc(when(pub.at)) : '') + '</small><div class="wk-pub-acts">'
      + '<a class="btn sm" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('external') + 'Open</a>'
      + '<button type="button" class="btn sm" data-copy>' + icon('copy') + 'Copy link</button></div></div>' : '')
    + '<div data-user-box' + (askUser ? '' : ' hidden') + '>' + nameField('user', 'Your publishing name', HOST,
      owner, '/', askUser ? 'Picked once: it’s the first part of all your site links.' : '') + '</div>'
    + nameField('site', pub ? 'Address' : 'Choose your site’s address', HOST + (owner ? owner + '/' : '…/'),
      pub ? pub.name : suggest(w.title), '/')
    + (askUser ? '' : '<button type="button" class="btn sm ghost wk-pub-user" data-change-user>' + icon('edit')
      + 'Change publishing name</button>')
    + (hasIndex ? '' : '<p class="wk-pub-warn">' + icon('alert') + 'Add an index.html first: it’s the page people '
      + 'see at your link.</p>')
    + '<button type="button" class="btn primary wk-pub-go" data-go' + (hasIndex ? '' : ' disabled') + '>'
    + icon('globe') + (pub ? 'Republish' : 'Publish') + '</button>'
    + (pub ? '<button type="button" class="btn ghost wk-pub-down" data-down>' + icon('trash') + 'Take down</button>'
      : '')
    + '<p class="wk-pub-note">Sites are public. Only static files go live (HTML, CSS, JavaScript, images), with a '
    + 'small “Made with Colon” badge.</p></div>';
  var q = function (s) { return el.querySelector(s); };
  // 0.38.0: the live link and Open go to the Colon Browser app on the phone (a new tab on the web)
  el.querySelectorAll('.wk-pub a[target="_blank"]').forEach(function (a) { a.addEventListener('click', function (e) {
    if (!C.native.can('openInBrowserApp')) return;
    e.preventDefault(); C.native.openSite(a.href); }); });
  var site = q('[data-site]'), user = q('[data-user]'), go = q('[data-go]');
  function say(k, text, bad) { var m = q('[data-msg-' + k + ']'); m.textContent = text || '';
    m.className = bad ? 'wk-bad' : 'wk-ok'; }
  function sync() { go.disabled = busy || !hasIndex || !ok.site || (askUser && !ok.user); }
  var checkSite = C.debounce(function () {
    var name = clean(site), mine = ++seq.site;
    if (pub && name === pub.name) { ok.site = true; say('site', ''); sync(); return; }
    o.data.checkWorkspacePublish(o.id, name).then(function (r) {
      if (mine !== seq.site) return;
      ok.site = r.ok; say('site', r.ok ? 'Available' : r.reason, !r.ok); sync();
    }).catch(function (e) { if (mine === seq.site) say('site', e.message, true); });
  }, 350);
  var checkUser = C.debounce(function () {
    var name = clean(user), mine = ++seq.user;
    q('[data-pre-site]').textContent = HOST + (name || '…') + '/';
    if (name === owner && owner) { ok.user = true; say('user', ''); sync(); return; }
    o.data.checkWorkspaceOwner(name).then(function (r) {
      if (mine !== seq.user) return;
      ok.user = r.ok; say('user', r.ok ? 'Available' : r.reason, !r.ok); sync();
    }).catch(function (e) { if (mine === seq.user) say('user', e.message, true); });
  }, 350);
  site.addEventListener('input', function () { ok.site = false; sync(); say('site', 'Checking…'); checkSite(); });
  user.addEventListener('input', function () { ok.user = false; sync(); say('user', 'Checking…'); checkUser(); });
  if (askUser) { ok.user = false; sync(); if (!owner) setTimeout(function () { user.focus(); }, 50); }
  if (!pub) checkSite();
  var change = q('[data-change-user]');
  if (change) {
    change.addEventListener('click', function () {
      askUser = true; q('[data-user-box]').hidden = false; change.hidden = true;
      say('user', 'Changing it moves all your sites to new links; links you already shared stop working.');
      user.focus();
    });
  }

  function publish() {
    return o.data.publishWorkspace(o.id, clean(site)).then(function (r) {
      C.toast('Live at ' + r.url.replace(/^https:\/\//, ''), 'ok', { label: 'Open', fn: function () {
        C.native.openSite(r.url); } });
      o.onChanged();
    });
  }
  go.addEventListener('click', function () {
    if (busy || !ok.site || (askUser && !ok.user)) return;
    busy = true; sync(); go.lastChild.textContent = pub ? 'Republishing…' : 'Publishing…';
    var first = askUser && clean(user) !== owner ? o.data.setWorkspaceOwner(clean(user)).catch(function (e) {
      e.field = 'username'; throw e; }) : Promise.resolve();
    first.then(publish).catch(function (e) {
      busy = false; sync(); go.lastChild.textContent = pub ? 'Republish' : 'Publish';
      if (e.field === 'username' || e.code === 'no_username') {
        askUser = true; q('[data-user-box]').hidden = false; say('user', e.message, true);
      } else if (e.field === 'name' || e.code === 'invalid') say('site', e.message, true);
      else C.toast(e.message, 'bad');
    });
  });
  var copy = q('[data-copy]');
  if (copy) {
    copy.addEventListener('click', function () {
      C.copyText(url).then(function () { C.toast('Link copied.', 'ok'); });
    });
  }
  var down = q('[data-down]');
  if (down) {
    down.addEventListener('click', function () {
      C.confirm({ title: 'Take this site down?', body: url.replace(/^https:\/\//, '') + ' stops working. Your files '
        + 'stay here, and you can publish again any time.', confirm: 'Take down', danger: true }).then(function (y) {
        if (!y) return;
        o.data.unpublishWorkspace(o.id).then(function () { C.toast('Site taken down.', 'ok'); o.onChanged(); })
          .catch(function (e) { C.toast(e.message, 'bad'); });
      });
    });
  }
}

export { mount };
