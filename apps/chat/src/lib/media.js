/* Colon AI · attachments and voice input for the composer.
   Attachments: file picker, drag and drop, paste. Each file is validated (type, size, count),
   shows a preview, real progress, and a clear error state with retry/remove.
   Voice: English uses live dictation (Web Speech API) when the browser has it. Pidgin, Yorùbá, Hausa and Igbo
   (and any browser without dictation) record with MediaRecorder and Colon speech transcribes on the server into
   the message box, editable before sending; if that fails the recording is kept as a voice note.
   Permission-denied, no-microphone and unsupported states are explained in the composer.
   ChatMedia.create({ data, tray, voiceBar, getSettings, onChange, onTranscript, onVoiceDone }) */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { langLabel, transcribe } from '../core/voice-client.js';

var C = Colon, icon = C.icon, esc = C.esc;
var KIND_ICON = { image: 'image', pdf: 'fileText', doc: 'fileText', text: 'file', audio: 'mic' };

function create(o) {
  var data = o.data, items = [], tray = o.tray, bar = o.voiceBar;
  var input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = data.LIMITS.accept; input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });

  function changed() { render(); if (o.onChange) o.onChange(api.state()); }
  function render() {
    tray.hidden = !items.length;
    tray.innerHTML = items.map(function (it) {
      var thumb = it.thumb ? '<img src="' + it.thumb + '" alt="">' : icon(KIND_ICON[it.kind] || 'file');
      var status = it.status === 'error' ? '<span class="att-err">' + esc(it.error)
        + '</span>' : it.status === 'uploading' ? '<span class="att-sub">' + Math.round(it.progress * 100) + '% · '
        + C.fmtBytes(it.file.size) + '</span>' : '<span class="att-sub">' + C.fmtBytes(it.file.size)
        + (it.kind === 'audio' && it.duration ? ' · ' + it.duration + ' s' : '') + '</span>';
      return '<div class="att ' + it.status + '" data-att="' + it.key + '">' +
        '<span class="att-thumb">' + thumb + '</span><span class="att-body"><span class="att-name">'
          + esc(it.file.name) + '</span>' + status +
        (it.status === 'uploading' ? '<span class="progress"><i style="width:' + Math.round(it.progress * 100)
          + '%"></i></span>' : '') + '</span>' +
        (it.status === 'error' && it.retry ? '<button type="button" class="icon-btn sm" data-retry="' + it.key
          + '" aria-label="Retry ' + esc(it.file.name) + '">' + icon('refresh') + '</button>' : '') +
        '<button type="button" class="icon-btn sm att-x" data-remove="' + it.key + '" aria-label="Remove '
          + esc(it.file.name) + '">' + icon('x') + '</button></div>';
    }).join('');
  }
  tray.addEventListener('click', function (e) {
    var r = e.target.closest('[data-remove]'); if (r) return remove(r.getAttribute('data-remove'));
    var t = e.target.closest('[data-retry]'); if (t) { var it = find(t.getAttribute('data-retry')); if (it) start(it); }
  });
  function find(key) { return items.filter(function (i) { return i.key === key; })[0]; }

  function addFiles(list, opts) {
    opts = opts || {};
    Array.prototype.forEach.call(list || [], function (file) {
      if (items.filter(function (i) { return i.status !== 'error'; }).length >= data.LIMITS.perMessage) {
        C.toast('You can attach up to ' + data.LIMITS.perMessage + ' files per message.', 'bad'); return;
      }
      var it = { key: C.uid('a'), file: file, status: 'uploading', progress: 0, kind: null, duration: opts.duration
        || null };
      try { it.kind = data.classify(file, opts).kind; }
      catch (e) { it.status = 'error'; it.error = e.message; it.kind = 'file'; items.push(it); C.toast(e.message,
        'bad'); return; }
      if (it.kind === 'image') it.thumb = URL.createObjectURL(file);
      items.push(it); start(it, opts);
    });
    changed();
  }
  function start(it, opts) {
    it.status = 'uploading'; it.progress = 0; it.error = null; it.ctl = new AbortController(); changed();
    data.upload(it.file, { onProgress: function (p) { it.progress = p; render(); }, signal: it.ctl.signal,
      fromRecorder: (opts && opts.fromRecorder) || it.kind === 'audio', duration: it.duration })
      .then(function (att) { it.status = 'ready'; it.att = att; changed(); },
        function (e) { if (e.name === 'AbortError') return; it.status = 'error'; it.error = e.code === 'processing'
          || e.code === 'offline' ? e.message : (e.message || 'Upload failed.'); it.retry = e.code !== 'unsupported'
          && e.code !== 'too_large'; changed(); });
  }
  function remove(key) {
    var it = find(key); if (!it) return;
    if (it.ctl) it.ctl.abort();
    if (it.thumb) URL.revokeObjectURL(it.thumb);
    if (it.att) data.removeUpload(it.att.id).catch(function () {});
    items = items.filter(function (i) { return i !== it; }); changed();
  }

  /* ---------- Voice ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var voice = null; // { kind:'dictation'|'recorder', colon?, ... }
  function voiceLang() { var s = o.getSettings ? o.getSettings() : {}; return (s.voice && s.voice.lang) || 'en-NG'; }
  // auto: English with dictation when the browser has it; everything else through Colon speech (server).
  function voiceMethod() { var s = o.getSettings ? o.getSettings() : {}; var m = (s.voice && s.voice.method) || 'auto';
    if (m === 'dictation' && !SR) m = 'colon';
    return m === 'auto' ? (SR && /^en-/.test(voiceLang()) ? 'dictation' : 'colon') : m; }
  function voiceError(kind) {
    var msg = {
      denied: ['Microphone access is blocked',
        ('Allow the microphone for this site in your browser settings (tap the lock icon in the address bar), then '
        + 'try again.')],
      nomic: ['No microphone found', 'Connect a microphone or headset, then try again.'],
      unsupported: ['Voice input isn’t available here',
        'This browser can’t record audio. Try Chrome on Android, or type your message.'],
      network: ['Voice service unavailable', 'Dictation needs an internet connection. Check your data and try again.'],
      insecure: ['Voice needs a secure connection', 'Open Colon AI over https to use the microphone.']
    }[kind] || ['Voice input stopped', 'Something went wrong with the microphone. Try again.'];
    bar.hidden = false; bar.className = 'cv-voice error';
    bar.innerHTML = '<span class="cv-voice-ico">' + icon('micOff') + '</span><span class="cv-voice-body"><b>' + esc(msg[
      0]) + '</b><span>' + esc(msg[1])
      + '</span></span><button type="button" class="icon-btn sm" data-voice-dismiss aria-label="Dismiss">' + icon('x')
      + '</button>';
    voice = null; if (o.onVoiceState) o.onVoiceState(false);
  }
  bar.addEventListener('click', function (e) {
    if (e.target.closest('[data-voice-dismiss]')) { bar.hidden = true; return; }
    if (e.target.closest('[data-voice-stop]')) stopVoice();
    if (e.target.closest('[data-voice-cancel]')) cancelVoice();
  });
  function showBusy(label) {
    bar.hidden = false; bar.className = 'cv-voice busy';
    bar.innerHTML = '<span class="spinner sm" aria-hidden="true"></span><span class="cv-voice-body"><b>' + esc(label)
      + '</b></span>';
  }
  // Colon speech: transcribe on the server, put the words in the message box. On failure keep the recording.
  function viaColon(file, dur, lang) {
    showBusy('Transcribing ' + langLabel(lang) + '…');
    if (o.onVoiceState) o.onVoiceState(true);
    transcribe(file, { lang: lang, duration: dur, name: file.name }).then(function (t) {
      bar.hidden = true; bar.innerHTML = ''; if (o.onVoiceState) o.onVoiceState(false);
      if (o.onTranscript) o.onTranscript(t.text, true);
    }, function (e) {
      bar.hidden = true; bar.innerHTML = ''; if (o.onVoiceState) o.onVoiceState(false);
      if (e.code === 'no_speech') return C.toast('I didn’t catch any speech. Try again a little closer to the mic.');
      var guest = data.kind === 'guest';
      C.toast((e.message || 'Couldn’t transcribe that.') + (guest ? '' : ' Added it as a voice note instead.'), 'bad');
      if (!guest) addFiles([file], { fromRecorder: true, duration: dur });
    });
  }
  function showRecording(label) {
    bar.hidden = false; bar.className = 'cv-voice live';
    bar.innerHTML = '<span class="cv-rec-dot" aria-hidden="true"></span><span class="cv-voice-body"><b>' + esc(label)
      + '</b><span class="cv-interim" aria-live="polite"></span></span>' +
      ('<span class="cv-level" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="cv-time '
        + 'mono">0:00</span>') +
      ('<button type="button" class="btn xs ghost" data-voice-cancel>Cancel</button><button type="button" '
        + 'class="btn xs primary" data-voice-stop>') + icon('check') + 'Done</button>';
    var t0 = Date.now();
    voice.timer = setInterval(function () { var s = Math.floor((Date.now() - t0) / 1000), el = bar.querySelector(
      '.cv-time'); if (el) el.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
      if (s >= 300) stopVoice(); }, 250);
    if (o.onVoiceState) o.onVoiceState(true);
  }
  function levels(stream) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ac = new AC(), src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 256;
        src.connect(an);
      var buf = new Uint8Array(an.frequencyBinCount);
      voice.ac = ac;
      (function tick() {
        if (!voice || voice.ac !== ac) return;
        an.getByteFrequencyData(buf); var bars = bar.querySelectorAll('.cv-level i');
        for (var i = 0; i < bars.length; i++) { var v = buf[4 + i * 6] / 255; bars[i].style.transform = 'scaleY('
          + (0.2 + v * 1.2).toFixed(2) + ')'; }
        requestAnimationFrame(tick);
      })();
    } catch (e) {}
  }
  function startVoice() {
    if (voice) return stopVoice();
    if (!window.isSecureContext) return voiceError('insecure');
    var method = voiceMethod(), s = o.getSettings ? o.getSettings() : {};
    if (method === 'dictation' && SR) {
      var rec = new SR(); rec.lang = (s.voice && s.voice.lang) || 'en-NG'; rec.interimResults = true;
        rec.continuous = true;
      voice = { kind: 'dictation', rec: rec, finalText: '', cancelled: false };
      rec.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) voice.finalText += e.results[
          i][0].transcript + ' '; else interim += e.results[i][0].transcript; }
        var el = bar.querySelector('.cv-interim'); if (el) el.textContent = (voice.finalText + interim).trim()
          || 'Listening…';
        if (o.onTranscript) o.onTranscript((voice.finalText + interim).trim(), false);
      };
      rec.onerror = function (e) {
        var v = voice; cleanup();
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') voiceError('denied');
        else if (e.error === 'audio-capture') voiceError('nomic');
        else if (e.error === 'network') voiceError('network');
        else if (e.error === 'no-speech') { C.toast('I didn’t hear anything. Try again.'); }
        else if (e.error !== 'aborted') voiceError('other');
        void v;
      };
      rec.onend = function () { if (!voice || voice.kind !== 'dictation') return; var v = voice; cleanup();
        if (!v.cancelled && o.onTranscript) o.onTranscript(v.finalText.trim(), true); };
      try { rec.start(); showRecording('Listening in ' + langLabel(rec.lang) + '… speak now'); } catch (e) {
        cleanup(); voiceError('other'); }
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return voiceError(
      'unsupported');
    voice = { kind: 'pending' };
    var colon = method === 'colon', lang = voiceLang();
    // Mono with the browser's noise suppression; a low bitrate keeps uploads small on slow networks.
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true,
      autoGainControl: true, channelCount: 1 } }).then(function (stream) {
      var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (t) {
        return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
      var opts = { audioBitsPerSecond: 24000 }; if (type) opts.mimeType = type;
      var mr, chunks = [], t0 = Date.now();
      try { mr = new MediaRecorder(stream, opts); } catch (e) { mr = new MediaRecorder(stream); }
      voice = { kind: 'recorder', mr: mr, stream: stream, cancelled: false, colon: colon, lang: lang };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        var v = voice; cleanup();
        if (!v || v.cancelled || !chunks.length) return;
        var mime = mr.mimeType || 'audio/webm', ext = /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
        var dur = Math.max(1, Math.round((Date.now() - t0) / 1000));
        var file = new File(chunks, 'Voice note ' + new Date().toLocaleTimeString([], { hour: '2-digit',
          minute: '2-digit' }).replace(':', '.') + '.' + ext, { type: mime.split(';')[0] });
        if (v.colon) viaColon(file, dur, v.lang);
        else { addFiles([file], { fromRecorder: true, duration: dur }); if (o.onVoiceDone) o.onVoiceDone(file); }
      };
      mr.start(250); showRecording(colon ? 'Listening in ' + langLabel(lang) + '… tap Done when you finish'
        : 'Recording voice note'); levels(stream);
    }, function (e) {
      voice = null;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') voiceError('denied');
      else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') voiceError('nomic');
      else voiceError('other');
    });
  }
  function cleanup() {
    if (!voice) return;
    clearInterval(voice.timer);
    if (voice.stream) voice.stream.getTracks().forEach(function (t) { t.stop(); });
    if (voice.ac) voice.ac.close().catch(function () {});
    voice = null; bar.hidden = true; bar.innerHTML = '';
    if (o.onVoiceState) o.onVoiceState(false);
  }
  function stopVoice() { if (!voice) return; if (voice.kind === 'dictation') voice.rec.stop();
    else if (voice.kind === 'recorder') voice.mr.stop(); }
  function cancelVoice() { if (!voice) return; voice.cancelled = true; if (voice.kind === 'dictation') {
    voice.rec.abort(); cleanup(); if (o.onTranscript) o.onTranscript('', 'cancel');
    } else if (voice.kind === 'recorder') voice.mr.stop(); }
  // Permission check for Settings → Voice.
  function testMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve('unsupported');
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (
      t) { t.stop(); }); return 'granted'; },
      function (e) { return e.name === 'NotAllowedError' ? 'denied' : e.name === 'NotFoundError' ? 'nomic' : 'error';
        });
  }

  var api = {
    pick: function () { input.click(); }, addFiles: addFiles, remove: remove,
    ready: function () { return items.filter(function (i) { return i.status === 'ready'; }).map(function (i) {
      return i.att; }); },
    state: function () { return { count: items.length, uploading: items.some(function (i) {
      return i.status === 'uploading'; }), errors: items.filter(function (i) { return i.status === 'error'; }).length,
      ready: items.filter(function (i) { return i.status === 'ready'; }).length }; },
    clear: function (keepFiles) { items.forEach(function (i) { if (i.thumb) URL.revokeObjectURL(i.thumb);
      if (!keepFiles && i.att) data.removeUpload(i.att.id).catch(function () {}); }); items = []; changed(); },
    startVoice: startVoice, stopVoice: stopVoice, cancelVoice: cancelVoice, voiceActive: function () { return !!voice;
      }, testMic: testMic,
    hasDictation: !!SR, destroy: function () { cleanup(); input.remove(); }
  };
  return api;
}

const ChatMedia = { create: create };
window.ChatMedia = ChatMedia;

export { ChatMedia };
