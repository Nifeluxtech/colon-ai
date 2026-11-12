/* Colon AI · the "log in to see this" screen guests get for History, Saved and Settings. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;

// Guests: History, Saved and Settings belong to an account.
CW.pages.login = function (page, ctx) {
  var what = { '/history': ['history', 'Your chat history'], '/saved': ['saved', 'Saved chats'], '/settings': [
    'settings', 'Settings'] }[ctx && ctx.path] || ['user', 'Your account'];
  page.innerHTML = '<div class="cw-screen"><div class="card empty cw-login-page">' + icon(what[0]) + '<div class="h3">'
    + esc(what[1]) + ' needs an account</div>' +
    '<p class="small">Log in to save your chats, find them again and pick up on any device. Signing up is free.</p>' +
    ('<div class="cw-guest-btns" style="justify-content:center"><button type="button" class="btn primary" '
      + 'data-a="login">Log in</button><button type="button" class="btn" data-a="signup">Sign up</button></div>') +
    ('<a class="link small" href="#/" style="display:inline-block;margin-top:14px">Keep chatting as a '
      + 'guest</a></div></div>');
};
