/* Colon Admin · Voice settings. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { opt, sel, sw } from '../components/form.js';
import { fail, head, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, $ = C.$, $$ = C.$$;

/* ================= Voice ================= */
function voice(view) {
  gate(view, function () {
    view.innerHTML = head('Voice', 'Speech-to-text and text-to-speech engines. Saved now, used by Voice (Phase 6).')
      + '<div id="vc">' + skel(3) + '</div>';
    C.api('/admin/voice').then(function (d) {
      var V = d.voice, E = d.engines;
      var part = function (k, title) {
        var x = V[k];
        return '<div class="card form"><div class="h3">' + title + '</div><div class="list">' + sw(k + '_enabled',
          'Enabled', '', x.enabled) + '</div>' +
          sel(k + '_engine', 'Engine', x.engine, E[k].map(function (e) { return [e, e]; })) +
          (k === 'stt' ? opt('stt_model', 'Model', x.model, 'e.g. whisper-large-v3') : opt('tts_voice', 'Voice',
            x.voice, 'e.g. ng-female-1')) +
          opt(k + '_endpoint', 'Endpoint (optional)', x.endpoint, 'https://…', 'url') + opt(k + '_languages',
            'Languages', x.languages) + '</div>';
      };
      $('#vc', view).innerHTML = '<form novalidate class="adm-stack">' + part('stt', 'Speech to text (STT)') + part(
        'tts', 'Text to speech (TTS)')
        + '<button class="btn primary block" type="submit">Save voice settings</button></form>';
      C.bindForm($('form', view), function (f) {
        return C.api('/admin/voice', { method: 'PATCH', body: {
          stt: { enabled: f.stt_enabled, engine: f.stt_engine, model: f.stt_model, endpoint: f.stt_endpoint,
            languages: f.stt_languages },
          tts: { enabled: f.tts_enabled, engine: f.tts_engine, voice: f.tts_voice, endpoint: f.tts_endpoint,
            languages: f.tts_languages } } }).then(function () { C.toast('Voice settings saved.', 'ok'); });
      });
    }).catch(function (e) { fail($('#vc', view), e); });
  });
}

export { voice };
