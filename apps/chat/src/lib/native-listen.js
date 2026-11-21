/* Colon AI · the phone's own speech recognizer inside the Android app (0.20.1). Android System WebView has no
   working Web Speech API, so English used to be recorded and sent to the server, which was slow (one turn could
   take most of a minute) and gave no live words. When the app has a speech service (feature "listen": Android's
   SpeechRecognizer, usually Google's, free and fast), this stands in for window.SpeechRecognition, with the same
   shape media.js already drives: lang, start(), stop(), abort(), onresult, onerror, onend, plus onlevel(0–1) for
   the voice orb. The app answers ColonNative.call('listen', {action: start|stop|cancel, id, lang}) and sends the
   event 'listen' {id, type: partial|final|level|error|end, text?, v?, error?}. */
import { Colon } from '../../../../packages/ui/js/colon.js';

var seq = 0;

function usable() { var N = Colon.native; return !!(N && N.hasBridge() && N.can('listen')); }

function NativeSR() {
  this.lang = 'en-NG'; this.interimResults = true; this.continuous = true;
  this.onresult = null; this.onerror = null; this.onend = null; this.onlevel = null; this.onready = null;
  this._id = null; this._off = null;
}

NativeSR.prototype._fire = function (name, arg) { var f = this[name]; if (f) { try { f.call(this, arg); } catch (e) {
  /* a page handler failed: keep the session going */ } } };

NativeSR.prototype._event = function (d) {
  if (!d || d.id !== this._id) return; // an older session's late event
  if (d.type === 'ready') return this._fire('onready');   // 0.22.1: the recognizer hears now (timings)
  if (d.type === 'level') return this._fire('onlevel', Math.max(0, Math.min(1, Number(d.v) || 0)));
  if (d.type === 'partial' || d.type === 'final') {
    var text = String(d.text || '');
    return this._fire('onresult', { results: [Object.assign([{ transcript: text }], { isFinal: d.type === 'final' })]
    });
  }
  if (d.type === 'error') return this._fire('onerror', { error: d.error || 'other' });
  if (d.type === 'end') { this._detach(); this._fire('onend'); }
};

NativeSR.prototype._detach = function () { if (this._off) { this._off(); this._off = null; } this._id = null; };

NativeSR.prototype.start = function () {
  var self = this, b = window.ColonNative;
  if (this._id) throw new Error('already started');
  this._id = 'l' + (++seq) + '-' + Date.now();
  var id = this._id;
  this._off = b.on('listen', function (d) { self._event(d); });
  b.call('listen', { action: 'start', id: id, lang: this.lang }).catch(function (e) {
    if (self._id !== id) return;
    self._fire('onerror', { error: e && e.code === 'denied' ? 'not-allowed' : 'other' });
    self._detach(); self._fire('onend');
  });
};

NativeSR.prototype.stop = function () {
  if (this._id) window.ColonNative.call('listen', { action: 'stop', id: this._id }).catch(function () {});
};

NativeSR.prototype.abort = function () {
  if (!this._id) return;
  window.ColonNative.call('listen', { action: 'cancel', id: this._id }).catch(function () {});
  this._detach();
};

export { NativeSR, usable };
