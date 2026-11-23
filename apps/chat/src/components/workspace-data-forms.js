/* Colon AI · Workspace data forms (v0.29.0, Workspace step 5; plan: docs/workspace/plan.md). The two sheets shared
   by the Data tab (workspace-data.js) and the chat's "needs" cards (workspace-chat.js):
     secretSheet(o, preset)  add or replace a secret key: name, value (never shown again), API host, how it's sent
     tableSheet(o, preset)   create a table or change who can read and add
   o = { id, data, onSaved() }; preset = { name, host, as, read, add, why, edit } fills the form. */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, esc = C.esc;

function asParts(as) {
  var m = /^(header|query):(.+)$/.exec(as || '');
  return m ? [m[1], m[2]] : ['bearer', ''];
}

function secretSheet(o, p) {
  p = p || {};
  var parts = asParts(p.as), edit = Boolean(p.edit);
  C.sheet('<form class="px-sheet wk-dsheet" novalidate><h2 class="h3">' + (edit ? 'Replace ' + esc(p.name)
    : 'Add a secret key') + '</h2>' + (p.why ? '<p class="small muted">Needed to ' + esc(p.why) + '.</p>' : '')
    + '<p class="small muted">Stored encrypted on Colon’s server. It never goes into your site’s files, and nobody '
    + 'can see it again, not even you.</p>'
    + '<label class="wk-f"><span>Name</span><input class="input" data-n maxlength="64" autocapitalize="characters" '
    + 'autocomplete="off" spellcheck="false" placeholder="e.g. PAYSTACK_KEY" value="' + esc(p.name || '') + '"'
    + (edit ? ' readonly' : '') + '></label>'
    + '<label class="wk-f"><span>Value</span><input class="input" type="password" data-v maxlength="4000" '
    + 'autocomplete="new-password" spellcheck="false" placeholder="' + (edit ? 'Leave empty to keep the current one'
      : 'Paste the key') + '"></label>'
    + '<label class="wk-f"><span>API host</span><input class="input" data-h maxlength="253" autocapitalize="off" '
    + 'autocomplete="off" spellcheck="false" placeholder="e.g. api.paystack.co" value="' + esc(p.host || '')
    + '"><small class="muted">Your site can only use this key with this host.</small></label>'
    + '<label class="wk-f"><span>Send it as</span><select class="input" data-as><option value="bearer">'
    + 'Bearer token (Authorization header)</option><option value="header">A header</option><option value="query">'
    + 'A URL parameter</option></select></label><label class="wk-f" data-pn-row><span data-pn-l>Header name</span>'
    + '<input class="input" data-pn maxlength="40" autocapitalize="off" autocomplete="off" spellcheck="false" value="'
    + esc(parts[1]) + '"></label><small class="wk-bad" data-err aria-live="polite"></small>'
    + '<div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button>'
    + '<button type="submit" class="btn primary">Save key</button></div></form>', function (el, close) {
    var f = function (s) { return el.querySelector(s); }, sel = f('[data-as]');
    sel.value = parts[0];
    function sync() {
      f('[data-pn-row]').hidden = sel.value === 'bearer';
      f('[data-pn-l]').textContent = sel.value === 'query' ? 'Parameter name' : 'Header name';
      f('[data-pn]').placeholder = sel.value === 'query' ? 'e.g. api_key' : 'e.g. X-Api-Key';
    }
    sel.addEventListener('change', sync); sync();
    f('[data-n]').addEventListener('input', function (e) {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); });
    setTimeout(function () { f(edit || p.name ? '[data-v]' : '[data-n]').focus(); }, 50);
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = f('[data-n]').value.trim(), v = f('[data-v]').value, pn = f('[data-pn]').value.trim();
      var body = { host: f('[data-h]').value.trim() || null, as: sel.value === 'bearer' ? 'bearer'
        : sel.value + ':' + pn };
      if (v) body.value = v;
      if (sel.value !== 'bearer' && !pn) { f('[data-err]').textContent = 'Give the ' + (sel.value === 'query'
        ? 'parameter' : 'header') + ' name.'; return; }
      o.data.putWorkspaceSecret(o.id, name, body).then(function () {
        close(); C.toast(name + ' saved.', 'ok'); if (o.onSaved) o.onSaved();
      }).catch(function (err) { f('[data-err]').textContent = err.message; });
    });
  }, { label: edit ? 'Replace key' : 'Add a secret key' });
}

function toggle(attr, label, on) {
  return '<label class="wk-tog"><input type="checkbox" ' + attr + (on ? ' checked' : '') + '><span>' + label
    + '</span></label>';
}

function tableSheet(o, p) {
  p = p || {};
  var edit = Boolean(p.edit);
  C.sheet('<form class="px-sheet wk-dsheet" novalidate><h2 class="h3">' + (edit ? 'Who can use “' + esc(p.name)
    + '”' : 'New table') + '</h2>' + (p.why ? '<p class="small muted">For ' + esc(p.why) + '.</p>' : '')
    + '<label class="wk-f"><span>Name</span><input class="input" data-n maxlength="48" autocapitalize="off" '
    + 'autocomplete="off" spellcheck="false" placeholder="e.g. orders" value="' + esc(p.name || '') + '"'
    + (edit ? ' readonly' : '') + '></label>'
    + toggle('data-read', 'Visitors can read it (e.g. blog posts, products)', p.read === 'public')
    + toggle('data-add', 'Visitors can add to it (e.g. orders, sign-ups, messages)', p.add === 'public')
    + '<p class="small muted">You can always see, add and delete everything here in Colon.</p>'
    + '<small class="wk-bad" data-err aria-live="polite"></small><div class="sheet-actions"><button type="button" '
    + 'class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">' + (edit ? 'Save'
      : 'Create table') + '</button></div></form>', function (el, close) {
    var f = function (s) { return el.querySelector(s); };
    f('[data-n]').addEventListener('input', function (e) {
      e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'); });
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = f('[data-n]').value.trim();
      o.data.putWorkspaceTable(o.id, name, { read: f('[data-read]').checked ? 'public' : 'owner',
        add: f('[data-add]').checked ? 'public' : 'owner' }).then(function () {
        close(); C.toast(edit ? 'Saved.' : 'Table “' + name + '” created.', 'ok'); if (o.onSaved) o.onSaved();
      }).catch(function (err) { f('[data-err]').textContent = err.message; });
    });
  }, { label: edit ? 'Table access' : 'New table' });
}

export { secretSheet, tableSheet };
