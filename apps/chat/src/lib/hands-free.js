/* Colon AI · hands-free conversation (Phase 6, 0.6.5). Listen → send when you stop talking → read the reply aloud
   → listen again, until you tap End (or Cancel on the recording bar, or the mic). Silence is detected from the
   dictation text (English, via the phone) or from the microphone level (Colon speech for Naijá, Yorùbá, Hausa,
   Igbo). Two turns in a row with no speech end the session.
   createHandsFree({ media, send, speak, bar, getSettings, toast, ui }) → { start, stop, active, transcript, level,
   replyDone, mute, muted }. 0.20.0: `ui` (the voice-mode overlay) hears every phase, the words heard, the reply
   spoken and the mic level; mute(true) pauses listening without ending the session (phase 'muted').
   0.22.1: a turn with no speech gets a spoken "I didn't catch that." (the second in a row ends voice mode after
   saying so); finalReply(text) says a command's reply and then ends (music started, or Colon left for another
   app); fail(text) says why the microphone stopped (permission, no recognizer…) and ends. */

import { reply } from './command-replies.js';
import { createTiming } from './voice-timing.js';

// 0.22.1: the reply is spoken sentence by sentence while it streams (the first sentence starts at once).
var SENTENCE = /[.!?…](?:["'”’)\]]*)(?=\s)|\n+/g;
function lastBoundary(text, from) {
  var at = -1, m; SENTENCE.lastIndex = from;
  while ((m = SENTENCE.exec(text))) at = m.index + m[0].length;
  return at;
}

var QUIET_AFTER_TEXT = 1600; // ms without new words before a dictated turn is sent
var QUIET_AFTER_VOICE = 1500; // ms below the speech level before a recorded turn is sent
var NO_SPEECH = 9000; // ms of nothing at all before the turn counts as a miss
var LOUD = 0.12; // average spectrum level (0–1) that counts as speech

function createHandsFree(o) {
  var state = 'idle', misses = 0, timer = null, pill = null, turn = null, muted = false, ui = o.ui || null;
  var talk = null, timing = createTiming(o.now), local = false;   // talk: the reply being spoken as it streams

  function setState(s, label) {
    var was = state; state = s;
    if ((was === 'idle') !== (s === 'idle') && o.onState) o.onState(s); // 0.18.1: the voice-mode button
    if (ui && was !== s) ui.phase(s);
    if (s === 'idle') { if (pill) pill.remove(); pill = null; return; }
    if (ui) return; // 0.20.1: the voice-mode overlay is the whole UI; no Hands-free bar over the composer
    if (!pill) {
      pill = document.createElement('div'); pill.className = 'cv-voice cv-hf'; pill.setAttribute('role', 'status');
      pill.innerHTML = '<span class="cv-rec-dot" aria-hidden="true"></span><span class="cv-voice-body"><b>'
        + 'Hands-free</b><span class="cv-hf-state"></span></span><button type="button" class="btn xs ghost" '
        + 'data-hf-end>End</button>';
      pill.querySelector('[data-hf-end]').addEventListener('click', function () { stop(); });
      // 0.20.0: the pill brings the full-screen voice overlay back after "Show chat".
      pill.querySelector('.cv-voice-body').addEventListener('click', function () { if (ui && ui.show) ui.show(); });
      o.bar.parentNode.insertBefore(pill, o.bar);
    }
    pill.querySelector('.cv-hf-state').textContent = label;
  }

  function clear() { clearInterval(timer); timer = null; turn = null; }

  function listen() {
    if (state === 'idle') return;
    if (muted) { clear(); return setState('muted', 'Mic muted. Unmute to talk'); }
    clear(); setState('listening', 'Listening… just start talking');
    talk = null; local = false; timing.reset(); timing.mark('listen');
    turn = { start: Date.now(), last: 0, text: '', heard: false };
    if (o.media.voiceActive()) o.media.stopVoice();
    o.media.startVoice();
    timer = setInterval(function () {
      if (!turn || !o.media.voiceActive()) return;
      var now = Date.now();
      if (turn.text && now - turn.last > QUIET_AFTER_TEXT) { clear(); o.media.stopVoice(); }
      else if (turn.heard && !turn.text && now - turn.last > QUIET_AFTER_VOICE) { clear(); o.media.stopVoice(); }
      else if (!turn.text && !turn.heard && now - turn.start > NO_SPEECH) { clear(); o.media.stopVoice(); }
    }, 250);
  }

  function start() {
    if (state !== 'idle') return;
    misses = 0; muted = false; setState('listening', 'Starting…');
    o.toast('Hands-free on. Talk, pause, and Colon answers out loud. Tap End to stop.');
    listen();
  }

  function stop() {
    if (state === 'idle') return;
    clear(); talk = null; var was = state; muted = false; setState('idle');
    if (o.media.voiceActive()) o.media.cancelVoice();
    if (was === 'speaking') o.speak.stop();
  }

  // Called by the chat page for every transcript update; returns true when hands-free handled the final one.
  function transcript(text, final) {
    if (state === 'idle') return false;
    if (state === 'muted') return true; // the turn muting cancelled: nothing to send
    if (final === 'cancel') { stop(); return true; }
    // 0.20.2: a late result from the recognizer while Colon thinks or speaks must not restart the turn.
    if (state === 'thinking' || state === 'speaking') return true;
    if (final !== true) { if (turn && text && text !== turn.text) { turn.text = text; turn.last = Date.now();
      if (ui) ui.heard(text); }
      return false; }
    if (ui && text) ui.heard(text);
    clear();
    if (!String(text || '').trim()) {
      if (++misses >= 2) sayThen(reply('give_up'), stop);
      else sayThen(reply('miss'), listen);
      return true;
    }
    misses = 0; setState('thinking', 'Colon is thinking…'); timing.mark('speechEnd');
    o.send();
    return true;
  }

  // Microphone level from the recorder (0–1), used to spot the end of a turn when there is no live text.
  function level(v) {
    if (!turn || state !== 'listening') return;
    if (ui) ui.level(v);
    if (v > LOUD) { turn.heard = true; turn.last = Date.now(); }
  }

  function voiceOpts(onEnd) {
    var v = (o.getSettings().voice) || {};
    return { engine: v.readAloudVoice || 'auto', speaker: v.speaker, rate: v.readAloudRate || 1, lang: v.lang,
      onEnd: onEnd, onAudio: function () { if (timing.mark('firstAudio') && o.onTiming) o.onTiming(
        timing.summary(local)); } };
  }

  // Says text in voice mode (caption, overlay and the phone's TTS), then runs next.
  function sayThen(text, next) {
    clear(); talk = null;
    if (o.media.voiceActive()) o.media.cancelVoice();
    if (ui) ui.say(text);
    timing.mark('firstToken');
    setState('speaking', 'Speaking… tap End to stop');
    o.speak.play(text.slice(0, 6000), voiceOpts(function () { if (state === 'speaking') next(); }));
  }

  /** 0.22.1: a command answered on the phone (no server): timings count it against the local budget. */
  function localReply() { local = true; }

  // Speaks the next queued sentence; when the reply is complete and all said, listens again.
  function pump() {
    if (!talk || talk.playing || state !== 'speaking') return;
    var next = talk.queue.shift();
    if (!next) { if (talk.done) { talk = null; setTimeout(listen, 300); } return; }
    talk.playing = true;
    o.speak.play(next, voiceOpts(function () { if (talk) talk.playing = false; pump(); }));
  }

  /** 0.22.1: the reply so far, while it streams (plain text): each finished sentence is spoken at once. */
  function partial(text) {
    if (state !== 'thinking' && !(state === 'speaking' && talk)) return;
    timing.mark('firstToken');
    if (!talk) talk = { at: 0, queue: [], playing: false, done: false };
    var cut = lastBoundary(text, talk.at);
    if (cut <= talk.at) return;
    var piece = text.slice(talk.at, cut).trim(); talk.at = cut;
    if (!piece) return;
    talk.queue.push(piece);
    if (ui) ui.say(text);
    if (state === 'thinking') setState('speaking', 'Speaking… tap End to stop');
    pump();
  }

  // 0.22.1: a command's reply that ends voice mode once it is said (music started, or Colon left for an app).
  function finalReply(text) {
    if (state !== 'thinking' || !text) { stop(); return; }
    sayThen(text, stop);
  }

  // 0.22.1: the microphone or the recognizer failed: say why, then end (never sit on "Listening…" for ever).
  function fail(text) {
    if (state === 'idle') return;
    o.toast(text, 'bad');
    sayThen(text, stop);
  }

  // Called when a reply finishes streaming.
  function replyDone(msg, text) {
    if (talk && state === 'speaking') {   // streamed: say what is left, then listen again
      var rest = String(text || '').slice(talk.at).trim();
      if (rest) talk.queue.push(rest);
      talk.done = true; if (ui && text) ui.say(text); pump(); return;
    }
    if (state !== 'thinking') return;
    if (!msg || msg.status !== 'complete' || !text) {
      o.toast('That reply didn’t come through. Listening again.', 'bad'); return listen();
    }
    if (ui) ui.say(text);
    timing.mark('firstToken'); talk = null;
    setState('speaking', 'Speaking… tap End to stop');
    o.speak.play(text.slice(0, 6000), voiceOpts(function () { if (state === 'speaking') setTimeout(listen, 300); }));
  }

  // 0.20.0: mute the mic without ending voice mode. While Colon thinks or speaks it takes effect at the next turn.
  function mute(on) {
    if (state === 'idle' || muted === !!on) return;
    muted = !!on;
    if (muted && state === 'listening') {
      clear(); setState('muted', 'Mic muted. Unmute to talk');
      if (o.media.voiceActive()) o.media.cancelVoice();
    } else if (!muted && state === 'muted') { misses = 0; listen(); }
  }

  // 0.20.1: the composer's voice button while voice mode runs brings the overlay back (End lives there).
  function reopen() { if (state === 'idle') return start(); if (ui && ui.show) ui.show(); else stop(); }

  return { start: start, stop: stop, reopen: reopen, active: function () { return state !== 'idle'; },
    transcript: transcript, level: level, replyDone: replyDone, finalReply: finalReply, fail: fail, mute: mute,
    partial: partial, localReply: localReply, ready: function () { timing.mark('ready'); },
    muted: function () { return muted; } };
}

export { createHandsFree };
