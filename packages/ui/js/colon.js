/* Colon App core: API client, router with smooth transitions, UI helpers, and the
   shared account screens (sign in, sign up, reset, verify, 2FA, sessions, profile).
   Used by every Colon web app: Colon.start({ app, title, nav, routes, home }).
   This file is the public face (window.Colon); the parts live in ./colon/. */

import { bindBanner, row, verifyBanner } from './colon/account.js';
import { api, refreshUser } from './colon/api.js';
import { authFlow, authModal, signedOut } from './colon/auth.js';
import { $, $$, ago, copyText, debounce, device, esc, fmtBytes, initials, uid } from './colon/dom.js';
import { bindForm, field } from './colon/forms.js';
import { MARK, icon, logo } from './colon/icons.js';
import { confirmDialog, drawer, keyboard, menu, promptDialog, resizable, sheet, toast,
  trapFocus } from './colon/overlays.js';
import { go, start } from './colon/router.js';
import { API, LANGS, hasRole, roleName, state, theme } from './colon/state.js';

const Colon = {
  version: '0.6.1', start: start, api: api, icon: icon, esc: esc, $: $, $$: $$, toast: toast, sheet: sheet,
  field: field, bindForm: bindForm, go: go, ago: ago, device: device, initials: initials, roleName: roleName,
  hasRole: hasRole, LANGS: LANGS, MARK: MARK, logo: logo, theme: theme, menu: menu, confirm: confirmDialog,
  prompt: promptDialog, drawer: drawer, keyboard: keyboard, resizable: resizable, copyText: copyText,
  fmtBytes: fmtBytes, uid: uid, debounce: debounce, trapFocus: trapFocus, get API() { return API; },
  logout: function () {
    return api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { signedOut(); });
  },
  authModal: authModal, authFlow: authFlow, get online() { return state.online; },
  get config() { return state.config; }, get user() { return state.user; }, refreshUser: refreshUser,
  verifyBanner: verifyBanner, bindBanner: bindBanner, row: row
};
window.Colon = Colon;

export { Colon };
