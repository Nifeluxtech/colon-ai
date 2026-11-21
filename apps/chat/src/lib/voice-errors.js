/* Colon AI · why voice input stopped, in words (0.22.1; moved out of media.js). VOICE_ERRORS: the composer's error
   bar (title, help). spokenError(kind, inApp): the short line voice mode shows and says before it ends, so it never
   sits on "Listening…" with a dead microphone. Kinds: denied · nomic · unsupported · network · insecure · busy ·
   language · other. Recognizer errors from the phone (native-listen.js) arrive under the Web Speech API's names. */

var VOICE_ERRORS = {
  denied: ['Microphone access is blocked',
    'Allow the microphone for this site in your browser settings (tap the lock icon in the address bar), then '
    + 'try again.'],
  nomic: ['No microphone found', 'Connect a microphone or headset, then try again.'],
  unsupported: ['Voice input isn’t available here',
    'This browser can’t record audio. Try Chrome on Android, or type your message.'],
  network: ['Voice service unavailable', 'Dictation needs an internet connection. Check your data and try again.'],
  insecure: ['Voice needs a secure connection', 'Open Colon AI over https to use the microphone.'],
  busy: ['The microphone is busy', 'Another app is using the microphone. Close it, then try again.'],
  language: ['Language not available', 'The phone’s speech service can’t listen in this language.']
};
var OTHER = ['Voice input stopped', 'Something went wrong with the microphone. Try again.'];

function voiceErrorText(kind) { return VOICE_ERRORS[kind] || OTHER; }

/** Web Speech / phone recognizer error name -> our kind (null: not an error that stops voice input). */
function errorKind(name) {
  switch (name) {
    case 'not-allowed': case 'service-not-allowed': return 'denied';
    case 'audio-capture': return 'nomic';
    case 'network': return 'network';
    case 'busy': return 'busy';
    case 'language': return 'language';
    case 'aborted': return null;
    default: return 'other';
  }
}

function spokenError(kind, inApp) {
  switch (kind) {
    case 'denied': return inApp ? 'Microphone permission needed. Tap Open Colon to allow it.'
      : 'Microphone permission needed. Allow the microphone for this site, then try again.';
    case 'nomic': return 'I can’t find a microphone.';
    case 'network': return 'I can’t reach the speech service. Check your connection and try again.';
    case 'busy': return 'Another app is using the microphone, so I can’t listen right now.';
    case 'unsupported': return 'Voice input isn’t available here.';
    case 'language': return 'The phone’s speech service can’t listen in this language.';
    default: return 'The microphone stopped working. Please try again.';
  }
}

// Permission check for Settings → Voice (from media.js).
function testMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve('unsupported');
  return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
    s.getTracks().forEach(function (t) { t.stop(); }); return 'granted';
  }, function (e) { return e.name === 'NotAllowedError' ? 'denied' : e.name === 'NotFoundError' ? 'nomic' : 'error'; });
}

export { errorKind, spokenError, testMic, voiceErrorText, VOICE_ERRORS };
