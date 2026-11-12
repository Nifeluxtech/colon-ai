/* Colon Admin · the provider and model edit sheets (base URL, API type, encrypted API key, model fields). */

import { act, area, sel, sw } from './form.js';
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

function providerSheet(p, canKeys, reload) {
  var isNew = !p;
  C.sheet('<div class="h2">' + (isNew ? 'Add provider' : esc(p.name)) + '</div>' + (isNew
    ? '<p class="small muted">Any OpenAI-compatible API (or the native Gemini API).</p>' : '<p class="small muted">'
    + esc(p.id) + (p.builtin ? ' · built in' : ' · custom') + '</p>') +
    '<form class="form" data-pf novalidate>' + (isNew ? C.field({ name: 'id', label: 'Id (short, lowercase)',
      placeholder: 'e.g. together' }) : '') +
    C.field({ name: 'name', label: 'Name', value: isNew ? '' : p.name }) + C.field({ name: 'base_url',
      label: 'Base URL', value: isNew ? '' : p.base_url, placeholder: 'https://…/v1', required: false }) +
    sel('native', 'API type', isNew ? '' : p.native, [['', 'OpenAI-compatible'], ['gemini', 'Native Gemini API']]) +
    (isNew ? '' : '<div class="list">' + sw('enabled', 'Enabled', 'Off removes it from every route', p.enabled)
      + '</div>') +
    '<button class="btn primary block" type="submit">' + (isNew ? 'Add provider' : 'Save') + '</button></form>' +
    (isNew ? '' : '<div class="section-title">API key</div>' + (canKeys
      ? '<form class="form" data-kf novalidate><p class="small muted">Current: ' + (p.key.source === 'database'
        ? esc(p.key.masked) + ' (stored encrypted)' : p.key.source === 'environment' ? 'from the server environment' :
        'none') + '. A stored key wins over the environment one. It is never shown again.</p>' +
        C.field({ name: 'api_key', label: 'New API key', type: 'password', auto: 'off' })
          + '<button class="btn primary block" type="submit">Save key</button>' + (p.key.source === 'database'
          ? '<button class="btn danger block" type="button" data-clear>Remove stored key</button>' : '') + '</form>'
      : '<p class="small muted">' + icon('lock') + ' Only a Super Admin can view or change API keys.</p>') +
      (p.in_db ? '<button class="btn ghost block" type="button" data-reset style="margin-top:8px">' + (p.builtin
        ? 'Reset to server defaults' : 'Delete provider') + '</button>' : '')) +
    '<button class="btn ghost block" type="button" data-close>Close</button>', function (el, close) {
    C.bindForm($('[data-pf]', el), function (f) {
      var req = isNew ? C.api('/admin/providers', { method: 'POST', body: { id: f.id, name: f.name,
        base_url: f.base_url, native: f.native } })
        : C.api('/admin/providers/' + p.id, { method: 'PATCH', body: { name: f.name, base_url: f.base_url,
          native: f.native, enabled: f.enabled } });
      return req.then(function () { C.toast('Saved.', 'ok'); close(); reload(); });
    });
    var kf = $('[data-kf]', el);
    if (kf) C.bindForm(kf, function (f) { return C.api('/admin/providers/' + p.id + '/key', { method: 'POST',
      body: { api_key: f.api_key } }).then(function () { C.toast('Key saved (encrypted).', 'ok'); close(); reload();
      }); });
    var cl = $('[data-clear]', el);
    if (cl) cl.addEventListener('click', function () { C.confirm({ title: 'Remove the stored key?',
      body: 'The provider falls back to the key in the server environment, if there is one.', confirm: 'Remove',
      danger: true }).then(function (ok) { if (ok) act(C.api('/admin/providers/' + p.id + '/key', { method: 'POST',
      body: { api_key: '' } }), function () { C.toast('Key removed.'); close(); reload(); }); }); });
    var rs = $('[data-reset]', el);
    if (rs) rs.addEventListener('click', function () { C.confirm({ title: p.builtin ? 'Reset ' + p.name
      + '?' : 'Delete ' + p.name + '?', body: p.builtin
      ? 'Name, URL, on/off and any stored key go back to the server settings.' :
      'Models using it stop working until you move them.', confirm: p.builtin ? 'Reset' : 'Delete',
      danger: true }).then(function (ok) { if (ok) act(C.api('/admin/providers/' + p.id, { method: 'DELETE' }),
      function () { C.toast('Done.'); close(); reload(); }); }); });
  });
}

function modelSheet(m, providers, reload) {
  var isNew = !m;
  C.sheet('<div class="h2">' + (isNew ? 'Add model' : esc(m.model))
    + ('</div><p class="small muted">A slot (like “qwen” or “deepseek”) groups models tried in order. Routing picks '
    + 'slots per mode.</p>') +
    '<form class="form" novalidate>' + C.field({ name: 'target', label: 'Slot', value: isNew ? '' : m.target,
      placeholder: 'e.g. qwen' }) +
    sel('provider_id', 'Provider', isNew ? providers[0] : m.provider_id, providers.map(function (p) { return [p, p];
      })) +
    C.field({ name: 'model', label: 'Model id (as the provider names it)', value: isNew ? '' : m.model }) +
    C.field({ name: 'priority', label: 'Order in slot (0 = first)', type: 'number', value: isNew ? 0 : m.priority }) +
    area('body', 'Extra request options (JSON, optional)', isNew || !m.body ? '' : (typeof m.body === 'string'
      ? m.body : JSON.stringify(m.body)), '{"chat_template_kwargs":{"thinking":false}}') +
    '<div class="list">' + sw('vision', 'Reads images', '', !isNew && m.vision) + sw('enabled', 'Enabled', '',
      isNew || m.enabled) + '</div>' +
    '<button class="btn primary block" type="submit">' + (isNew ? 'Add model' : 'Save') + '</button>' + (isNew
      ? '' : '<button class="btn danger block" type="button" data-del>Delete</button>') +
    '<button class="btn ghost block" type="button" data-close>Close</button></form>', function (el, close) {
    C.bindForm($('form', el), function (f) {
      var body = { target: f.target, provider_id: f.provider_id, model: f.model, priority: Number(f.priority || 0),
        body: f.body, vision: f.vision, enabled: f.enabled };
      return C.api(isNew ? '/admin/models' : '/admin/models/' + m.id, { method: isNew ? 'POST' : 'PATCH',
        body: body }).then(function () { C.toast('Saved.', 'ok'); close(); reload(); });
    });
    var del = $('[data-del]', el);
    if (del) del.addEventListener('click', function () { C.confirm({ title: 'Delete ' + m.model + '?',
      confirm: 'Delete', danger: true }).then(function (ok) { if (ok) act(C.api('/admin/models/' + m.id,
      { method: 'DELETE' }), function () { C.toast('Deleted.'); close(); reload(); }); }); });
  });
}

export { modelSheet, providerSheet };
