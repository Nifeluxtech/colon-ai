/* Colon AI · header title and the model picker. */

import { autoGrow, renderDevChips, renderModeChips } from './composer.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { $, CAPS, MODES, S, data, mode, modelId, modelName } from '../core/state.js';

var C = Colon, icon = C.icon;

/* ================= Header ================= */
function updateHeader() {
  var m = mode(), inChat = S.view === 'chat';
  $('[data-model-name]').textContent = modelName(modelId());
  $('[data-mode-sub]').textContent = MODES[m].sub;
  var t = $('.cw-title'); t.hidden = !inChat || !S.current;
  $('[data-title]').textContent = S.current ? S.current.title : '';
  var titles = { welcome: 'New chat', history: 'History', saved: 'Saved', explore: 'Explore', settings: 'Settings',
    help: 'Help & Support', login: 'Log in', shared: 'Shared chat' };
  document.title = (inChat && S.current ? S.current.title : titles[S.view] || 'Colon AI') + ' · Colon AI';
  var mb = $('.cw-mode-btn');
  mb.classList.toggle('on', m !== 'general'); mb.setAttribute('aria-label', 'Mode: ' + MODES[m].label
    + '. Change mode');
  mb.innerHTML = icon(MODES[m].icon) + '<span class="cw-mode-l">' + MODES[m].label + '</span>' + icon('chevDown');
  $('#cw-input').placeholder = MODES[m].hint;
  renderModeChips(); renderDevChips(); if (S.view === 'welcome' || S.view === 'chat') autoGrow();
}
function modelMenu(anchor) {
  if (!S.models.length) { C.toast('No models are configured yet.', 'bad'); return; }
  var cur = modelId();
  C.menu(anchor, [{ head: 'Choose a model' }].concat(S.models.map(function (m) {
    return {
      label: m.name, sub: m.description + (m.capabilities && m.capabilities.length ? ' · ' + m.capabilities.map(
        function (c) { return CAPS[c] || c; }).join(', ') : ''),
      checked: m.id === cur, disabled: !m.available,
      badge: '<span class="badge ' + (m.available ? 'ok' : '') + '" style="margin-left:6px">' + (m.available
        ? 'Available' : m.status === 'coming_soon' ? 'Coming soon' : 'Unavailable') + '</span>',
      onClick: function () {
        if (S.current) data.updateConversation(S.current.id, { model: m.id }).then(function (c) { S.current =
          Object.assign(S.current, c); updateHeader(); C.toast('Using ' + m.name + '.'); });
        else { S.draftModel = m.id; updateHeader(); C.toast('Using ' + m.name + '.'); }
      }
    };
  })), { label: 'Models', sheetOnMobile: true });
}

export { modelMenu, updateHeader };
