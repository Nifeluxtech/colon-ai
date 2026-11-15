/* Colon AI · Saga 0.11.0 in the chat: Colon Secured Login (the secure card, the password warning on the composer),
   messages that steer a running task, extracted tables with a CSV download, speed mode, and the overlay watch that
   keeps the app's browser card under the chat's menus and sheets (ADR 0007).
   Logins: the card never has a field of its own. In the Colon AI app it opens the app's native form (FLAG_SECURE,
   values straight into the phone's Keystore-encrypted vault); the page only ever gets { site, login_saved }
   (no user name), and the thread keeps only "Login saved for <site>". On the web it explains that
   logins can only be saved in the app, with its download link. */

import { addThreadNote, nativeBrowser } from '../components/browser-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonStore } from '../../../../packages/ui/js/store.js';
import { S } from '../core/state.js';
import { looksLikePassword } from '../lib/secret-text.js';
import { createOverlayWatch } from '../lib/overlay-watch.js';
import { guideNote } from '../lib/saga-route.js';
import { CW } from '../core/cw.js';
import { csvName, csvOf, markdownTable, rowsFromTable } from '../lib/table-csv.js';

var C = Colon, esc = C.esc;
var prefs = ColonStore.prefs('colon.saga', { speed: false });

/* ---------- Speed mode (per device: slow networks are a device's) ---------- */
function speedOn() { return !!prefs.get().speed; }
function setSpeed(on) { prefs.set(Object.assign({}, prefs.get(), { speed: !!on })); }

/* ---------- Colon Secured Login ---------- */
function canVault() { return C.native.can && C.native.can('vault'); }

/** The secure card. site: what Saga (or the user) wants a login for ('' = the user names it in the form). why: a
 *  line saying why it appeared. Resolves { site, login_saved } (never a value). */
function loginCard(site, why) {
  var app = canVault();
  return new Promise(function (resolve) {
    var result = { site: site || '', login_saved: false };
    C.sheet('<div class="cw-login-card"><div class="h3">' + C.icon('lock') + ' Colon Secured Login</div>'
      + (why ? '<p class="small">' + esc(why) + '</p>' : '')
      + (site ? '<p class="small">Site: <b>' + esc(site) + '</b></p>' : '')
      + (app ? '<p class="small muted">Your user name and password go into a secure form of the Colon AI app and are '
        + 'kept only on this phone, encrypted. They never appear in this chat, on Colon’s servers or to Saga: Saga '
        + 'only learns that a login is saved.</p><label class="small"><input type="checkbox" data-trust checked> Saga '
        + 'may sign in on this site for me (it still asks me once)</label>'
        : '<p class="small">Logins can only be saved in the Colon AI app for Android: they stay on your phone, '
        + 'encrypted, and never pass through this website. Please don’t type a password in the chat.</p>')
      + '<div class="cw-login-actions"><button class="btn ghost" data-close type="button">Not now</button>'
      + (app ? '<button class="btn primary" data-open type="button">Open secure form</button>'
        : '<a class="btn primary" target="_blank" rel="noopener" href="' + esc(C.native.APK) + '">Get the app</a>')
      + '</div></div>', function (el, close) {
      var b = el.querySelector('[data-open]');
      if (b) b.addEventListener('click', function () {
        var trust = !!(el.querySelector('[data-trust]') || {}).checked;
        close();
        C.native.call('vault', { action: 'form', site: site || '', trust: trust }).then(function (r) {
          result = { site: (r && r.site) || site || '', login_saved: !!(r && r.login_saved) };
          if (result.login_saved) {
            addThreadNote('🔒 Login saved for **' + esc(result.site) + '** in Colon Secured Login on this phone.', {})
              .catch(function () {});
          }
          resolve(result);
        }, function () { resolve(result); });
      });
    }, { label: 'Colon Secured Login', onClose: function () { if (!canVault()) resolve(result); } });
  });
}

/** Before the composer sends: a message that looks like a password is held back. true = send it anyway. */
function passwordGuard(text) {
  if (!looksLikePassword(text)) return Promise.resolve(true);
  return new Promise(function (resolve) {
    C.sheet('<div class="cw-login-card"><div class="h3">' + C.icon('alert') + ' That looks like a password</div>'
      + '<p class="small">Passwords don’t belong in the chat: messages are kept in your history and sent to the AI. '
      + 'Save it in Colon Secured Login instead, where it stays on your phone.</p><div class="cw-login-actions">'
      + '<button class="btn ghost" data-send type="button">Send anyway</button><button class="btn primary" '
      + 'data-secure type="button">Use Colon Secured Login</button></div></div>', function (el, close) {
      el.querySelector('[data-send]').addEventListener('click', function () { close(); resolve(true); });
      el.querySelector('[data-secure]').addEventListener('click', function () {
        close(); resolve(false); loginCard('', 'Save the login here instead of in the chat.');
      });
    }, { label: 'Password warning', onClose: function () { resolve(false); } });
  });
}

/* ---------- Ask while it works ---------- */
/** A message for the running task: Saga takes it into account at its next step, without stopping. 0.11.6: kept in
 *  the thread with a visible line (not only a toast); rejects with code 'waiting' when Saga waits for the user
 *  (nothing is added then: the caller sends it to the chat model instead). */
function guide(taskId, text) {
  return C.api('/browser/agent/' + encodeURIComponent(taskId) + '/guide', { method: 'POST', body: { text: text } })
    .then(function () {
      return addThreadNote(text, { role: 'user', title: text }).then(function () {
        return addThreadNote(guideNote(), {}); });
    });
}

/* ---------- Extracted tables ---------- */
/** The thread note for each table Saga pulled out (with a CSV link the page handles). */
function tableNotes(actions) {
  return actions.filter(function (a) { return a.kind === 'extract' && a.args && Array.isArray(a.args.rows)
    && a.args.rows.length; }).map(function (a) {
    var t = a.args, label = t.caption || (a.url ? String(a.url).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]
      : 'the page');
    return '**Data from ' + esc(label) + '** (' + t.rows.length + (t.total > t.rows.length ? ' of ' + t.total : '')
      + ' rows)\n\n' + markdownTable(t.columns || [], t.rows) + '\n\n[⬇ Download CSV](#colon-csv)';
  });
}

function downloadCsv(link) {
  var msg = link.closest('.cw-msg, .cw-bubble') || document;
  var table = msg.querySelector('table');
  if (!table) { C.toast('The table isn’t on screen any more.', 'bad'); return; }
  var t = rowsFromTable(table), name = csvName((msg.querySelector('strong') || {}).textContent || 'saga-table');
  var blob = new Blob([csvOf(t.columns, t.rows)], { type: 'text/csv;charset=utf-8' });
  C.native.saveBlob(blob, name).then(function (saved) {
    if (saved) return;
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }, function () { C.toast('The CSV couldn’t be saved.', 'bad'); });
}

/* ---------- Overlays over the app's browser card ---------- */
var watch = null, clicks = false;
function watchOverlays(root) {
  if (!(C.native.can && C.native.can('browserSuspend'))) return function () {};
  if (watch) watch.stop();
  var w = watch = createOverlayWatch({ doc: document, root: root, MutationObserver: window.MutationObserver,
    raf: window.requestAnimationFrame.bind(window), onChange: function (open) {
      nativeBrowser('suspend', { on: open }).catch(function () {}); } });
  return function () { if (watch === w) { w.stop(); watch = null; } };
}

/** At chat start: CSV links, the overlay watch and speed mode. Returns a stop function (unmount). */
function install(root) {
  if (!clicks) {
    clicks = true;
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href="#colon-csv"], a[href="#colon-login"], '
        + 'a[href="#colon-stop"]');
      if (!a) return;
      e.preventDefault();
      // 0.11.6: the waiting note's actions (saga-wait.js): reopen the login form, Stop.
      if (a.getAttribute('href') !== '#colon-csv') { if (CW.sagaWaitLink) CW.sagaWaitLink(a.getAttribute('href'));
        return; }
      downloadCsv(a);
    });
  }
  if (S.browser) S.browser.speed = speedOn;
  return watchOverlays(root);
}

export { guide, install, loginCard, passwordGuard, setSpeed, speedOn, tableNotes, watchOverlays };
