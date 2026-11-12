/* Colon AI · sidebar: conversation list, conversation menu, drawer (phones), collapse (desktop), profile and
   more menus, theme toggle and sign out. */

import { openBrowser, setLayout } from './browser-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { deleteConv } from '../actions/delete.js';
import { patchConv, renameConv, shareConv } from '../actions/rename.js';
import { CW } from '../core/cw.js';
import { $, MODES, S, data, ephemeral, isMobile, signedIn } from '../core/state.js';
import { login } from '../pages/chat.js';

var C = Colon, icon = C.icon, esc = C.esc;

/* ================= Sidebar ================= */
var refreshConvs = C.debounce(function () {
  data.listConversations({ q: S.q }).then(function (list) { S.convs = list; renderConvs(); })
    .catch(function (e) { $('#cw-convs').innerHTML = '<div class="cw-convs-msg">' + esc(e.message)
      + ' <button class="link" data-a="retry-convs" style="background:none;border:0">Retry</button></div>'; });
}, 120);
CW.refreshConvs = refreshConvs;
function renderConvs() {
  var box = $('#cw-convs'); if (!box) return;
  if (ephemeral()) {
    box.innerHTML = (
      '<div class="cw-guest-card"><b>Log in to save your chats</b><span>Your conversations will be saved to your '
      + 'account, so you can pick them up on any device.</span>') +
      ('<div class="cw-guest-btns"><button type="button" class="btn primary sm" data-a="login">Log '
        + 'in</button><button type="button" class="btn sm" data-a="signup">Sign up</button></div></div>');
    return;
  }
  if (!S.convs) { box.innerHTML = '<div class="skel" style="height:36px;margin:6px"></div>'; return; }
  var cur = S.current && S.current.id;
  function item(c) {
    return '<div class="cw-conv' + (c.id === cur ? ' on' : '') + '"><a href="#/c/' + encodeURIComponent(c.id) + '"'
      + (c.id === cur ? ' aria-current="page"' : '') + '><span class="cw-conv-t">' + (c.pinned ? icon('pin',
      'cw-pin') : '') + esc(c.title) + '</span>' +
      '<span class="cw-conv-m">' + esc(MODES[c.mode] ? MODES[c.mode].label : '') + ' · ' + esc(C.ago(c.updated_at))
        + (c.temporary ? ' · temporary' : '') + '</span></a>' +
      '<button class="icon-btn sm cw-conv-more" data-conv-menu="' + esc(c.id) + '" aria-label="Options for '
        + esc(c.title) + '" aria-haspopup="menu">' + icon('more') + '</button></div>';
  }
  if (S.q) {
    box.innerHTML = '<div class="cw-convs-h">Results</div>' + (S.convs.length ? S.convs.map(item).join(
      '') : '<div class="cw-convs-msg">No chats match “' + esc(S.q) + '”.</div>');
    return;
  }
  var pinned = S.convs.filter(function (c) { return c.pinned; }), recent = S.convs.filter(function (c) {
    return !c.pinned; }).slice(0, 30);
  box.innerHTML = (pinned.length ? '<div class="cw-convs-h">' + icon('saved') + 'Saved</div>' + pinned.map(item).join(
    '') : '') +
    '<div class="cw-convs-h">' + icon('clock') + 'Recent</div>' + (recent.length ? recent.map(item).join(
      '') : '<div class="cw-convs-msg">' + (S.convs.length ? 'All your chats are saved above.' :
      'Your conversations will appear here.') + '</div>') +
    (!signedIn() && data.kind === 'local'
      ? ('<div class="cw-convs-msg">Saved on this device only. <button type="button" class="link cw-inline-link" '
      + 'data-a="login">Log in</button> to sync.</div>') : '') +
    (S.convs.length > 30 + pinned.length ? '<a class="cw-convs-all" href="#/history">See all history</a>' : '');
}
CW.convMenu = function (anchor, c, after) {
  var canShare = data.kind === 'remote' && !c.temporary;
  C.menu(anchor, [
    { label: 'Rename', icon: 'edit', onClick: function () { renameConv(c, after); } }].concat(canShare ? [
    { label: c.shared ? 'Copy share link' : 'Share link', icon: 'link', onClick: function () { shareConv(c, after);
      } }] : []).concat([
    { label: c.pinned ? 'Remove from Saved' : 'Save (pin)', icon: 'pin', onClick: function () { patchConv(c,
      { pinned: !c.pinned }, c.pinned ? 'Removed from Saved.' : 'Saved.', after); } },
    { label: c.archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: function () { patchConv(c,
      { archived: !c.archived }, c.archived ? 'Moved back to Recent.' : 'Archived. Find it in History.', after); } },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, onClick: function () { deleteConv(c, after); } }
  ]), { align: 'right', label: 'Conversation options' });
};
function applySidebar() {
  S.el.classList.toggle('side-collapsed', S.collapsed && !isMobile());
  var side = $('#cw-side');
  if (isMobile()) { if (!S.drawer) side.setAttribute('inert', ''); } else side.removeAttribute('inert');
}
function openDrawer() { S.drawer = true; S.el.classList.add('drawer-open'); document.querySelector(
  '.cw-drawer-back').classList.add('open'); $('#cw-side').removeAttribute('inert'); setTimeout(function () { var f = $(
  '#cw-side .cw-new'); if (f) f.focus(); }, 60); }
function closeDrawer() { if (!S.drawer) return; S.drawer = false; S.el.classList.remove('drawer-open');
  var b = document.querySelector('.cw-drawer-back'); if (b) b.classList.remove('open');
  if (isMobile()) $('#cw-side').setAttribute('inert', ''); }
function toggleSidebar() {
  if (isMobile()) { S.drawer ? closeDrawer() : openDrawer(); return; }
  S.collapsed = !S.collapsed; localStorage.setItem('colon.sidebar', S.collapsed ? 'closed' : 'open'); applySidebar();
}

function profileMenu(anchor) {
  var u = C.user || {};
  C.menu(anchor, [
    { html: '<div class="cw-menu-user"><span class="avatar">' + esc(C.initials(u.name, u.email)) + '</span><span><b>'
      + esc(u.name || 'Your account') + '</b><small>' + esc(u.email || '') + '</small></span></div>' }, '-',
    { label: 'Settings', icon: 'settings', onClick: function () { C.go('/settings'); } },
    { label: 'Account & security', icon: 'shield', onClick: function () { C.go('/account'); } },
    { label: C.theme.current() === 'dark' ? 'Light mode' : 'Dark mode', icon: C.theme.current() === 'dark'
      ? 'sun' : 'moon', onClick: toggleTheme },
    { label: 'Help & Support', icon: 'help', onClick: function () { C.go('/help'); } }, '-',
    { label: 'Sign out', icon: 'out', danger: true, onClick: signOut }
  ], { align: 'right', label: 'Profile' });
}
function moreMenu(anchor) {
  if (!signedIn()) {
    C.menu(anchor, [
      { label: 'Log in', icon: 'user', onClick: function () { login('login'); } },
      { label: 'Sign up', icon: 'sparkle', onClick: function () { login('signup'); } }, '-',
      { label: S.browser.layout === 'none' ? 'Open browser' : 'Close browser', icon: 'globe', onClick: function () {
        S.browser.layout === 'none' ? openBrowser() : setLayout('none'); } },
      { label: C.theme.current() === 'dark' ? 'Light mode' : 'Dark mode', icon: C.theme.current() === 'dark'
        ? 'sun' : 'moon', onClick: toggleTheme },
      { label: 'Help & Support', icon: 'help', onClick: function () { C.go('/help'); } }
    ], { align: 'right', label: 'More' });
    return;
  }
  var shareItem = S.current && S.view === 'chat' && data.kind === 'remote' && !S.current.temporary && !S.loadingConv
    ? [{ label: 'Share chat', icon: 'link', onClick: function () { shareConv(S.current); } }] : [];
  C.menu(anchor, shareItem.concat([
    { label: S.browser.layout === 'none' ? 'Open browser' : 'Close browser', icon: 'globe', onClick: function () {
      S.browser.layout === 'none' ? openBrowser() : setLayout('none'); } },
    { label: C.theme.current() === 'dark' ? 'Light mode' : 'Dark mode', icon: C.theme.current() === 'dark'
      ? 'sun' : 'moon', onClick: toggleTheme },
    { label: 'Settings', icon: 'settings', onClick: function () { C.go('/settings'); } },
    { label: 'Account & security', icon: 'shield', onClick: function () { C.go('/account'); } }, '-',
    { label: 'Sign out', icon: 'out', danger: true, onClick: signOut }
  ]), { align: 'right', label: 'More' });
}
function signOut() { C.confirm({ title: 'Sign out of Colon?',
  body: 'Your chats stay in your account. You can keep chatting as a guest, but new chats won’t be saved.',
  confirm: 'Sign out' }).then(function (ok) { if (ok) C.logout(); }); }
CW.signOut = signOut;
function toggleTheme() { C.theme.toggle(); }

export { applySidebar, closeDrawer, moreMenu, openDrawer, profileMenu, refreshConvs, renderConvs, toggleSidebar,
  toggleTheme };
