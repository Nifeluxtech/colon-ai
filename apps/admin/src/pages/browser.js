/* Colon Admin · Colon Browser settings. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { head } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, $ = C.$, $$ = C.$$;

/* ================= Browser (placeholder) ================= */
function browser(view) {
  gate(view, function () {
    view.innerHTML = head('Browser', 'Colon Browser sessions.') +
      '<div class="card empty">' + icon('compass')
        + ('<div class="h3" style="color:var(--text)">Live sessions are coming</div><p class="small">Watching live '
        + 'browser sessions, failures and a kill switch arrive with the Android browser engine (Phases 8–10). Nothing '
        + 'to manage yet.</p></div>');
  });
}

export { browser };
