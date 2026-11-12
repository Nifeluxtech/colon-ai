/* Colon Admin · the gate every screen goes through: role check and the staff two-factor requirement. */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, $ = C.$, $$ = C.$$;

/* ---------- Helpers ---------- */
function gate(view, fn) {
  if (!C.hasRole('moderator')) {
    view.innerHTML = '<div class="card empty">' + icon('lock')
      + ('<div class="h3" style="color:var(--text)">No admin access</div><p class="small">This account is a Colon '
      + 'member. Ask a Super Admin for a staff role.</p><a class="btn" href="#/account">Go to account</a></div>');
    return;
  }
  if (!C.user.totp_enabled) {
    view.innerHTML = (
      '<div class="card"><div class="h2">Turn on two-factor first</div><p class="small muted">Admin tools need a '
      + 'code from an authenticator app every time you sign in. It takes a minute.</p><a class="btn primary block" '
      + 'href="#/account/security">') + icon('shield') + ' Set up two-factor</a></div>';
    return;
  }
  fn();
}

export { gate };
