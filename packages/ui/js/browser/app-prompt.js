/* ColonBrowser · the web "light mode" prompt. On the web the browser is a reader (pages as clean text, no
   scripts or logins); full browsing is the Colon Browser app. This bar says so and links the APK (Android) or the
   release page (other devices). Hidden inside the Android app, where pages open in a real WebView. */

import { Colon } from '../colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
var KEY = 'colon.appPrompt.hidden';

// Pure: which prompt to show for this context ('none' inside the app).
function promptKind(inShell, dismissed, forced) {
  if (inShell) return 'none';
  if (forced) return 'full';
  return dismissed ? 'none' : 'bar';
}
function dismissed() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
function dismiss() { try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* private mode */ } }
function link() { return C.native.browserAppLink(typeof navigator !== 'undefined' ? navigator.userAgent : ''); }

// The bar above reader pages; `forced` (error pages) can't be dismissed and explains more.
function appPromptHtml(forced) {
  var kind = promptKind(C.native.isShell(), dismissed(), forced);
  if (kind === 'none') return '';
  var android = link() !== C.native.RELEASES;
  return '<div class="cb-app-prompt' + (kind === 'full' ? ' full' : '') + '" role="note">' + icon('phone') +
    '<span class="cb-app-prompt-text"><b>Light mode.</b> ' + (kind === 'full'
      ? 'This site needs a full browser. Open it in the Colon Browser app for logins, video, forms and downloads.'
      : 'The web shows pages as clean text. Open in the app for full browsing.') + '</span>' +
    '<a class="btn xs primary" data-app-prompt href="' + esc(link()) + '" target="_blank" rel="noopener">'
    + (android ? 'Get the app' : 'Open in the app') + '</a>' +
    (kind === 'bar' ? '<button class="icon-btn sm" type="button" data-app-prompt-hide aria-label="Hide this tip">'
      + icon('x') + '</button>' : '') + '</div>';
}
function bindAppPrompt(root, rerender) {
  var x = root.querySelector('[data-app-prompt-hide]');
  if (x) x.addEventListener('click', function () { dismiss(); if (rerender) rerender(); });
}

export { appPromptHtml, bindAppPrompt, promptKind };
