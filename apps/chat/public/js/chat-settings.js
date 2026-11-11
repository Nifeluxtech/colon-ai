/* Colon AI · Settings screen: account, appearance, language, voice, chat preferences,
   privacy, data management and sign out. Account fields use the existing PATCH /account/profile;
   everything else goes through ColonChatData.saveSettings(). */
(function () {
  'use strict';
  var C = window.Colon, icon = C.icon, esc = C.esc;
  var CW = window.CW = window.CW || {};
  CW.pages = CW.pages || {};

  var SECTIONS = [['account', 'Account', 'user'], ['appearance', 'Appearance', 'palette'], ['language', 'Language', 'language'], ['voice', 'Voice', 'mic'], ['chat', 'Chat', 'chat'], ['privacy', 'Privacy', 'shield'], ['data', 'Data', 'database']];
  var VOICE_LANGS = [['en-NG', 'English (Nigeria)'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['yo-NG', 'Yorùbá'], ['ha-NG', 'Hausa'], ['ig-NG', 'Igbo']];

  function toggle(name, label, sub, on, disabled) {
    return '<label class="set-row"><span class="body"><span class="title">' + esc(label) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span>' +
      '<span class="switch"><input type="checkbox" data-set="' + name + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + ' aria-label="' + esc(label) + '"><i></i></span></label>';
  }
  function select(name, label, sub, value, options) {
    var id = 'set-' + name.replace(/\./g, '-');
    return '<div class="set-row stack"><span class="body"><label class="title" for="' + id + '">' + esc(label) + '</label>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span>' +
      '<select class="select" id="' + id + '" data-set="' + name + '">' + options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
  }
  function seg(name, label, sub, value, options) {
    return '<div class="set-row stack"><span class="body"><span class="title">' + esc(label) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span>' +
      '<div class="seg" role="group" aria-label="' + esc(label) + '">' + options.map(function (o) { return '<button type="button" data-seg="' + name + '" data-v="' + esc(o[0]) + '" aria-pressed="' + (o[0] === value) + '">' + (o[2] ? icon(o[2]) : '') + esc(o[1]) + '</button>'; }).join('') + '</div></div>';
  }
  function section(id, title, ic, body) { return '<section class="set-sec" id="set-' + id + '" aria-labelledby="set-h-' + id + '"><h2 class="set-h" id="set-h-' + id + '">' + icon(ic) + esc(title) + '</h2><div class="list">' + body + '</div></section>'; }

  CW.pages.settings = function (page, ctx) {
    var data = CW.data, media = CW.media();
    page.innerHTML = '<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">Settings</h1><p class="lead">Make Colon AI work your way.</p></div></header><div class="skel" style="height:240px"></div></div>';
    Promise.all([data.getSettings(), data.listModels().catch(function () { return []; })]).then(function (r) { render(r[0], r[1]); })
      .catch(function (e) { page.querySelector('.skel').outerHTML = '<div class="card empty">' + icon('alert') + '<div class="h3">Settings didn’t load</div><p class="small">' + esc(e.message) + '</p></div>'; });

    function render(s, models) {
      var u = C.user || {};
      page.innerHTML = '<div class="cw-screen set-screen"><header class="cw-screen-head"><div><h1 class="h1">Settings</h1><p class="lead">Make Colon AI work your way.</p></div></header>' +
        '<nav class="set-nav chips" aria-label="Settings sections">' + SECTIONS.map(function (x) { return '<a class="chip sm" href="#set-' + x[0] + '" data-jump="' + x[0] + '">' + icon(x[2]) + x[1] + '</a>'; }).join('') + '</nav>' +
        section('account', 'Account and profile', 'user',
          '<div class="set-row"><span class="avatar">' + esc(C.initials(u.name, u.email)) + '</span><span class="body"><span class="title">' + esc(u.name || 'Your account') + '</span><span class="sub">' + esc(u.email || '') + '</span></span><span class="badge primary">' + esc(C.roleName(u.role || 'user')) + '</span></div>' +
          '<form class="set-row stack" data-profile novalidate><span class="body"><label class="title" for="set-name">Display name</label><span class="sub">How Colon greets you.</span></span><span class="set-inline"><input class="input" id="set-name" maxlength="80" value="' + esc(u.name || '') + '" autocomplete="name"><button class="btn sm" type="submit">Save</button></span></form>' +
          C.row('#/account/security', 'shield', 'Password and two-factor', u.totp_enabled ? 'Two-factor is on' : 'Turn on two-factor for extra safety') +
          C.row('#/account/sessions', 'devices', 'Devices', 'Where you’re signed in')) +
        section('appearance', 'Appearance', 'palette',
          seg('theme', 'Theme', 'Light, dark, or match your device.', C.theme.get(), [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'Auto', 'devices']]) +
          seg('textSize', 'Text size', 'For messages and replies.', s.textSize, [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']])) +
        section('language', 'Language', 'language',
          select('language', 'Reply language', 'Colon Saga answers in this language when it can. Saved to your account.', u.language || 'en', Object.keys(C.LANGS).map(function (k) { return [k, C.LANGS[k]]; })) +
          '<div class="set-row"><span class="body"><span class="title">App language</span><span class="sub">English for now. Naijá, Yorùbá, Hausa and Igbo menus are coming.</span></span><span class="badge">English</span></div>') +
        section('voice', 'Voice', 'mic',
          select('voice.lang', 'Speech language', 'Used for dictation and read aloud.', s.voice.lang, VOICE_LANGS) +
          select('voice.method', 'Voice input method', media && media.hasDictation ? 'This browser supports live dictation.' : 'This browser can record voice notes; live dictation isn’t available.', s.voice.method, [['auto', 'Automatic (recommended)'], ['dictation', 'Live dictation (type what I say)'], ['recorder', 'Record a voice note']]) +
          toggle('voice.autoSend', 'Send after dictation', 'Send the message as soon as you stop speaking.', s.voice.autoSend) +
          select('voice.readAloudRate', 'Read-aloud speed', '', s.voice.readAloudRate, [[0.8, 'Slower'], [1, 'Normal'], [1.25, 'Faster']]) +
          '<div class="set-row"><span class="body"><span class="title">Microphone access</span><span class="sub" data-mic-state>Check that Colon can hear you.</span></span><button class="btn sm" type="button" data-test-mic>' + icon('mic') + 'Test</button></div>') +
        section('chat', 'Chat preferences', 'chat',
          select('defaultMode', 'Default mode for new chats', '', s.defaultMode, [['general', 'General'], ['study', 'Study'], ['developer', 'Developer'], ['research', 'Research']]) +
          (models.length ? select('defaultModel', 'Default model', 'From your Colon configuration.', s.defaultModel || '', [['', 'Automatic (Colon Saga)']].concat(models.filter(function (m) { return m.available; }).map(function (m) { return [m.id, m.name]; }))) : '') +
          toggle('enterToSend', 'Enter to send', 'Shift + Enter adds a new line. On phones, use the send button.', s.enterToSend) +
          toggle('streaming', 'Stream replies', 'Show answers word by word as they’re written.', s.streaming) +
          toggle('showMeta', 'Show mode on replies', 'Label each reply with the mode that wrote it.', s.showMeta) +
          toggle('linksInPanel', 'Open links in the browser panel', 'Links and sources open beside your chat instead of a new tab.', s.linksInPanel) +
          select('browserLayout', 'Browser panel layout', 'On phones the panel always opens inside the chat first.', s.browserLayout, [['split', 'Split screen'], ['embedded', 'Inside the conversation']])) +
        section('privacy', 'Privacy and security', 'shield',
          toggle('saveHistory', 'Save chat history', 'When off, new chats are temporary and disappear when you close Colon.', s.saveHistory) +
          toggle('shareFeedback', 'Help improve Colon Saga', 'Share the replies you rate (never your account details) to improve answers.', s.shareFeedback) +
          '<div class="set-row"><span class="body"><span class="title">Where your data lives</span><span class="sub">' + esc(data.describe) + '</span></span><span class="badge ' + (data.kind === 'local' ? 'cyan' : 'ok') + '">' + (data.kind === 'local' ? 'This device' : 'Colon account') + '</span></div>' +
          C.row('#/privacy', 'lock', 'Privacy Policy', '')) +
        section('data', 'Data and conversations', 'database',
          '<div class="set-row"><span class="body"><span class="title">Storage</span><span class="sub" data-stats>Counting…</span></span></div>' +
          '<button class="row" type="button" data-export><span class="ico">' + C.icon('download') + '</span><span class="body"><span class="title">Export conversations</span><span class="sub">Download everything as a JSON file.</span></span></button>' +
          C.row('#/history', 'archive', 'Archived conversations', 'Find them in History → Archived') +
          '<button class="row" type="button" data-clear-files><span class="ico">' + C.icon('file') + '</span><span class="body"><span class="title">Clear uploaded files</span><span class="sub">Remove attachments stored for your chats.</span></span></button>' +
          '<button class="row" type="button" data-delete-all><span class="ico" style="color:var(--bad);background:var(--bad-bg)">' + C.icon('trash') + '</span><span class="body"><span class="title" style="color:var(--bad)">Delete all conversations</span><span class="sub">Permanently remove every chat and file.</span></span></button>') +
        '<div class="set-out"><button class="btn block danger" type="button" data-signout>' + icon('out') + 'Sign out</button><p class="tiny muted" style="text-align:center;margin-top:14px">Colon AI v0.3.0 · ' + (data.kind === 'local' ? 'preview data mode' : 'synced') + ' · by Nifelux</p></div></div>';
      bind(s);
      stats();
      if (ctx && ctx.query && ctx.query.get('s')) jump(ctx.query.get('s'));
    }

    function save(patch, msg) {
      return data.saveSettings(patch).then(function (s) { CW.applySettings(s); C.toast(msg || 'Saved.', 'ok'); return s; }).catch(function (e) { C.toast(e.message, 'bad'); });
    }
    function setPath(name, value) {
      if (name.indexOf('voice.') === 0) { var v = {}; v[name.slice(6)] = value; return { voice: v }; }
      var o = {}; o[name] = value; return o;
    }
    function jump(id) { var el = page.querySelector('#set-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    function stats() {
      data.stats().then(function (st) {
        var el = page.querySelector('[data-stats]'); if (!el) return;
        el.textContent = st.conversations != null ? st.conversations + ' conversations · ' + st.messages + ' messages · ' + st.files + ' files · about ' + C.fmtBytes(st.bytes) + ' on ' + st.where.toLowerCase() : 'Stored in ' + st.where + '.';
      }).catch(function () {});
    }

    function bind(s) {
      page.querySelectorAll('[data-jump]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); jump(a.getAttribute('data-jump')); }); });
      page.querySelectorAll('input[data-set]').forEach(function (i) {
        i.addEventListener('change', function () {
          var name = i.getAttribute('data-set');
          if (name === 'saveHistory' && !i.checked) {
            C.confirm({ title: 'Turn off chat history?', body: 'New chats won’t be saved and will disappear when you close Colon. Existing chats stay until you delete them.', confirm: 'Turn off' }).then(function (ok) { if (ok) save({ saveHistory: false }, 'New chats will be temporary.'); else i.checked = true; });
            return;
          }
          save(setPath(name, i.checked));
        });
      });
      page.querySelectorAll('select[data-set]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var name = sel.getAttribute('data-set'), v = sel.value;
          if (name === 'language') {
            sel.disabled = true;
            C.api('/account/profile', { method: 'PATCH', body: { language: v } }).then(function () { return C.refreshUser(); }).then(function () { C.toast('Reply language: ' + C.LANGS[v] + '.', 'ok'); })
              .catch(function (e) { C.toast(e.message, 'bad'); sel.value = (C.user && C.user.language) || 'en'; }).then(function () { sel.disabled = false; });
            return;
          }
          if (name === 'voice.readAloudRate') v = Number(v);
          if (name === 'defaultModel') v = v || null;
          save(setPath(name, v));
        });
      });
      page.querySelectorAll('[data-seg]').forEach(function (b) {
        b.addEventListener('click', function () {
          var name = b.getAttribute('data-seg'), v = b.getAttribute('data-v');
          page.querySelectorAll('[data-seg="' + name + '"]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          if (name === 'theme') { C.theme.set(v); return; }
          save(setPath(name, v));
        });
      });
      var pf = page.querySelector('[data-profile]');
      pf.addEventListener('submit', function (e) {
        e.preventDefault(); var btn = pf.querySelector('button'), name = pf.querySelector('input').value.trim();
        if (!name) { pf.querySelector('input').classList.add('err'); C.toast('Enter your name.', 'bad'); return; }
        btn.classList.add('is-loading'); pf.querySelector('input').classList.remove('err');
        C.api('/account/profile', { method: 'PATCH', body: { name: name } }).then(function () { return C.refreshUser(); }).then(function () { C.toast('Name saved.', 'ok'); })
          .catch(function (e2) { C.toast(e2.message, 'bad'); }).then(function () { btn.classList.remove('is-loading'); });
      });
      page.querySelector('[data-test-mic]').addEventListener('click', function (e) {
        var b = e.currentTarget, out = page.querySelector('[data-mic-state]'); b.classList.add('is-loading');
        (media ? media.testMic() : Promise.resolve('unsupported')).then(function (st) {
          b.classList.remove('is-loading');
          out.textContent = { granted: '✓ Microphone is working and allowed.', denied: 'Blocked. Allow the microphone in your browser’s site settings (lock icon in the address bar).', nomic: 'No microphone found on this device.', unsupported: 'This browser can’t use the microphone.', error: 'The microphone couldn’t start. Try again.' }[st];
          out.style.color = st === 'granted' ? 'var(--ok)' : 'var(--bad)';
        });
      });
      page.querySelector('[data-export]').addEventListener('click', function (e) {
        var b = e.currentTarget; b.disabled = true;
        data.exportAll().then(function (d) {
          var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
          window.ColonBrowser.saveBlob(blob, 'colon-ai-conversations-' + new Date().toISOString().slice(0, 10) + '.json');
          C.toast('Export downloaded.', 'ok');
        }).catch(function (err) { C.toast(err.message, 'bad'); }).then(function () { b.disabled = false; });
      });
      page.querySelector('[data-clear-files]').addEventListener('click', function () {
        C.confirm({ title: 'Clear uploaded files?', body: 'Attachments will be removed from your chats. Messages stay.', confirm: 'Clear files', danger: true }).then(function (ok) {
          if (ok) data.clearFiles().then(function () { C.toast('Files cleared.'); stats(); }).catch(function (e) { C.toast(e.message, 'bad'); });
        });
      });
      page.querySelector('[data-delete-all]').addEventListener('click', function () {
        C.confirm({ title: 'Delete all conversations?', body: 'Every chat and uploaded file will be permanently deleted. Export first if you want a copy. This can’t be undone.', confirm: 'Delete everything', danger: true }).then(function (ok) {
          if (!ok) return;
          data.deleteAll().then(function () { C.toast('All conversations deleted.'); CW.refreshConvs(); stats(); }).catch(function (e) { C.toast(e.message, 'bad'); });
        });
      });
      page.querySelector('[data-signout]').addEventListener('click', function () { CW.signOut(); });
    }
  };
})();
