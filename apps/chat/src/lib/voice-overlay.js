/* Colon AI · voice mode overlay (0.20.0). A full-screen, ChatGPT-style voice screen over the chat while hands-free
   runs: a blurred dark backdrop, a large orb in the centre that breathes and follows the mic while listening,
   swirls while Colon thinks and pulses while it speaks, a short live caption, and Mute / End in the footer.
   "Show chat" hides it (the hands-free pill above the composer brings it back). Styles: chat-voice.css.
   Inside the Android app it also tells the app what to show in its floating pill over other apps
   (ColonNative 'voice_ui', feature "voice_ui") and takes the pill's End / Mute back (event 'voice_action').
   createVoiceOverlay({ onMute(on), onEnd(), muted() }) → { phase, heard, say, level, show, hide, model } */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { VoiceOrb } from './voice-orb.js';

var SEND_EVERY = 400; // ms between caption updates sent to the app (state changes go at once)

function reducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

function createVoiceOverlay(o) {
  var C = Colon, icon = C.icon, m = VoiceOrb.initial(), el = null, sent = VoiceOrb.initial(), sendTimer = null;
  var offNative = null, before = null, hidden = false;

  function build() {
    el = document.createElement('div');
    el.className = 'cv-vm'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Voice mode');
    el.innerHTML = '<div class="cv-vm-top"><button type="button" class="cv-vm-btn ghost" data-vm-hide '
      + 'aria-label="Show chat" data-tip="Show chat">' + icon('chev') + '</button><span class="cv-vm-label" '
      + 'aria-live="polite"></span><span class="cv-vm-spacer"></span></div>'
      + '<div class="cv-vm-stage" aria-hidden="true"><div class="cv-vm-orb"><i></i><i></i><i></i></div></div>'
      + '<p class="cv-vm-caption" aria-live="polite"></p>'
      + '<div class="cv-vm-foot"><button type="button" class="cv-vm-btn" data-vm-mute aria-pressed="false" '
      + 'aria-label="Mute microphone">' + icon('mic') + '</button><button type="button" class="cv-vm-btn end" '
      + 'data-vm-end aria-label="End voice mode">' + icon('x') + '</button></div>';
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-vm-end]')) return o.onEnd();
      if (e.target.closest('[data-vm-hide]')) return hide();
      if (e.target.closest('[data-vm-mute]')) { o.onMute(!o.muted()); paint(); sendNow(); }
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); o.onEnd(); } });
    document.body.appendChild(el);
  }

  function paint() {
    if (!el) return;
    var muted = !!o.muted(), btn = el.querySelector('[data-vm-mute]');
    el.setAttribute('data-state', m.state);
    el.querySelector('.cv-vm-label').textContent = VoiceOrb.label(m.state);
    el.querySelector('.cv-vm-caption').textContent = m.caption;
    btn.setAttribute('aria-pressed', String(muted)); btn.classList.toggle('on', muted);
    btn.setAttribute('aria-label', muted ? 'Unmute microphone' : 'Mute microphone');
    btn.innerHTML = icon(muted ? 'micOff' : 'mic');
    paintLevel();
  }

  function paintLevel() {
    if (el) el.style.setProperty('--vm-scale', String(VoiceOrb.orbScale(m, reducedMotion())));
  }

  function open() {
    if (!el) build();
    hidden = false; el.hidden = false;
    document.documentElement.classList.add('cv-vm-open');
    before = document.activeElement;
    var end = el.querySelector('[data-vm-end]'); if (end) end.focus({ preventScroll: true });
    listenNative();
  }

  function close() {
    if (el) { el.remove(); el = null; }
    document.documentElement.classList.remove('cv-vm-open');
    if (offNative) { offNative(); offNative = null; }
    if (before && before.focus && document.contains(before)) before.focus({ preventScroll: true });
    before = null; hidden = false;
  }

  function hide() {
    if (!el) return;
    hidden = true; el.hidden = true; document.documentElement.classList.remove('cv-vm-open');
    if (before && before.focus && document.contains(before)) before.focus({ preventScroll: true });
  }

  function show() { if (m.state !== 'idle' && (hidden || !el)) { open(); paint(); } }

  /* ---- the Android app's pill ---- */
  function listenNative() {
    var N = C.native;
    if (offNative || !N.can('voice_ui')) return;
    offNative = N.on('voice_action', function (d) {
      var a = d && d.action;
      if (a === 'end') o.onEnd();
      else if (a === 'mute' || a === 'unmute') { o.onMute(a === 'mute'); paint(); sendNow(); }
    });
  }

  function sendNow() {
    clearTimeout(sendTimer); sendTimer = null;
    if (!C.native.can('voice_ui')) return;
    sent = m;
    var p = VoiceOrb.nativePayload(m); p.muted = !!o.muted();
    C.native.call('voice_ui', p).catch(function () {});
  }

  function toNative(stateChanged) {
    if (!VoiceOrb.nativeChanged(sent, m)) return;
    if (stateChanged) return sendNow();
    if (!sendTimer) sendTimer = setTimeout(sendNow, SEND_EVERY);
  }

  function apply(e) {
    var prev = m; m = VoiceOrb.reduce(m, e);
    if (m === prev) return;
    var stateChanged = prev.state !== m.state;
    if (stateChanged && prev.state === 'idle') open();
    if (m.state === 'idle') { close(); toNative(true); return; }
    if (e.type === 'level') paintLevel(); else paint();
    if (e.type !== 'level') toNative(stateChanged);
  }

  return {
    phase: function (s) { apply({ type: 'phase', phase: s }); },
    heard: function (t) { apply({ type: 'heard', text: t }); },
    say: function (t) { apply({ type: 'say', text: t }); },
    level: function (v) { apply({ type: 'level', v: v }); },
    show: show, hide: hide, model: function () { return m; }
  };
}

export { createVoiceOverlay };
