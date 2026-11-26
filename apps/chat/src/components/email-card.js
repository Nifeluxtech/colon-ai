/* Colon AI · email cards (0.40.0): Send on an email Colon wrote (```email, packages/ui markdown) opens a "Send this
   email?" sheet with From, To, Subject and the text, all editable; nothing goes out until the user taps Approve.
   It sends with the user's own Gmail (send only, GET/POST /gmail…); without a connection the sheet offers to
   connect Gmail first (Google's page opens in the phone's browser: Google blocks sign-in inside apps). */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, esc = C.esc;

/** { to, cc, subject, body } from the card's text (To:/Cc:/Subject: lines, a blank line, the body). */
function parseEmail(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'), out = { to: '', cc: '', subject: '' }, i = 0;
  for (; i < lines.length; i++) {
    var m = /^(to|cc|subject)\s*:\s*(.*)$/i.exec(lines[i]);
    if (!m) break;
    out[m[1].toLowerCase()] = m[2].trim();
  }
  while (i < lines.length && !lines[i].trim()) i++;
  out.body = lines.slice(i).join('\n').trim();
  return out;
}

function connect() {
  return C.api('/gmail/connect', { method: 'POST' }).then(function (r) {
    var web = function () { window.location.href = r.url; };
    if (C.native.can && C.native.can('openExternal')) C.native.call('openExternal', { url: r.url }).catch(web);
    else web();
  });
}
function connectSheet(st) {
  C.sheet('<div class="h2">Connect your Gmail</div><p class="small muted" style="margin:6px 0 14px">Colon sends '
    + 'emails from your own Gmail, only when you tap Approve. It can’t read your inbox.</p>'
    + (st.configured ? '' : '<p class="small">Gmail isn’t switched on for this Colon server yet.</p>')
    + '<div class="sheet-actions"><button class="btn ghost" data-close>Not now</button>'
    + (st.configured ? '<button class="btn primary" data-connect>Connect Gmail</button>' : '') + '</div>',
  function (el, close) {
    var b = el.querySelector('[data-connect]');
    if (b) b.addEventListener('click', function () {
      b.disabled = true;
      connect().then(close, function (e) { b.disabled = false; C.toast(e.message, 'bad'); });
    });
  }, { label: 'Connect Gmail' });
}
function field(id, label, value, multi) {
  return '<div class="field"><label for="em-' + id + '">' + label + '</label>' + (multi
    ? '<textarea class="textarea" id="em-' + id + '" rows="9">' + esc(value) + '</textarea>'
    : '<input class="input" id="em-' + id + '" value="' + esc(value) + '"' + (id === 'from' ? ' readonly' : '')
      + '>') + '</div>';
}
function sendSheet(st, mail) {
  C.sheet('<div class="h2">Send this email?</div><form class="form em-send" novalidate>' + field('from', 'From',
    st.email || '') + field('to', 'To', mail.to) + (mail.cc ? field('cc', 'Cc', mail.cc) : '')
    + field('subject', 'Subject', mail.subject) + field('body', 'Email', mail.body, true)
    + '<p class="tiny muted">Emails can’t be unsent.</p><div class="sheet-actions"><button type="button" '
    + 'class="btn ghost" data-close>Dismiss</button><button class="btn primary" type="submit">Approve</button>'
    + '</div></form>', function (el, close) {
    var f = el.querySelector('form'), v = function (k) { var n = el.querySelector('#em-' + k); return n ? n.value
      : ''; };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var go = f.querySelector('[type=submit]'); go.disabled = true; go.textContent = 'Sending…';
      C.api('/gmail/send', { method: 'POST', body: { to: v('to'), cc: v('cc'), subject: v('subject'),
        body: v('body') } }).then(function () { close(); C.toast('Email sent from ' + (st.email || 'your Gmail')
        + '.', 'ok'); }, function (err) {
        go.disabled = false; go.textContent = 'Approve';
        if (err.code === 'gmail_reconnect' || err.code === 'gmail_not_connected') { close(); connectSheet(st); }
        C.toast(err.message, 'bad');
      });
    });
  }, { cls: 'wide', label: 'Send this email' });
}

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-email-send]');
  if (!b) return;
  var mail = parseEmail(b.closest('.md-email').querySelector('code').textContent);
  C.api('/gmail').then(function (st) { if (st.connected) sendSheet(st, mail); else connectSheet(st); },
    function () { C.toast('Log in to send emails with your Gmail.', 'bad'); });
});

/** Settings › Chat preferences: the Gmail row (connect, or who it sends as and Disconnect). */
function gmailRowHtml() {
  return '<div class="set-row" data-gmail-row><span class="body"><span class="title">Gmail (send only)</span>'
    + '<span class="sub" data-gmail-sub>Checking…</span></span><span data-gmail-act></span></div>';
}
function bindGmail(root, query) {
  var row = root.querySelector('[data-gmail-row]');
  if (!row) return;
  var sub = row.querySelector('[data-gmail-sub]'), act = row.querySelector('[data-gmail-act]');
  var said = { connected: 'Gmail connected.', scope: 'Tick “Send email on your behalf” on Google’s page.',
    failed: 'Gmail didn’t connect. Try again.', cancelled: '' }[query && query.get && query.get('gmail')];
  if (said) C.toast(said, query.get('gmail') === 'connected' ? 'ok' : 'bad');
  function load() {
    C.api('/gmail').then(function (st) {
      if (!st.configured && !st.connected) { sub.textContent = 'Not switched on for this Colon server yet.';
        act.innerHTML = ''; return; }
      sub.textContent = st.connected ? 'Sends as ' + st.email + ', only when you tap Approve'
        : 'Let Colon send the emails it writes, from your Gmail';
      act.innerHTML = '<button type="button" class="btn ghost small">' + (st.connected ? 'Disconnect' : 'Connect')
        + '</button>';
      act.firstChild.addEventListener('click', function () {
        if (!st.connected) { connect().catch(function (e) { C.toast(e.message, 'bad'); }); return; }
        C.api('/gmail', { method: 'DELETE' }).then(function () { C.toast('Gmail disconnected.', 'ok'); load(); },
          function (e) { C.toast(e.message, 'bad'); });
      });
    }, function () { sub.textContent = 'Log in to connect your Gmail.'; act.innerHTML = ''; });
  }
  load();
}

export { bindGmail, gmailRowHtml, parseEmail };
