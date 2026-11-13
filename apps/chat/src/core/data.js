/* Colon AI · data adapter. EVERY chat call goes through here; screens never call fetch directly.

   Three implementations, one interface. ColonChatData.get() picks one when the app starts (v0.4.4):
     RemoteChatData  core/api-client.js. Signed in and the API is reachable: chats sync to the Colon account.
     GuestChatData   core/guest-client.js. Signed out (or "Save chat history" off): replies stream from
                     POST /chat/guest and the conversation lives only in this tab's memory. Nothing is saved.
     LocalChatData   core/storage.js. The API can't be reached: the on-device Preview (IndexedDB +
                     lib/responder.js), so the app still works offline.
   Force a mode with localStorage['colon.data'] = 'local' | 'remote' (or window.COLON_DATA); default 'auto'.

   API endpoints (cookie session + X-Colon-Client header; full contract in docs/frontend-data-adapters.md):
     GET    /models -> { models:[{ id,name,description,available,status,default,capabilities[] }] }
     GET    /conversations?q=&archived=0|1|all
            -> { conversations:[{ id,title,mode,model,pinned,archived,preview,shared,created_at,updated_at }] }
     POST   /conversations { mode, model }        -> { conversation }
     GET    /conversations/:id -> { conversation, messages:[{ id,role,content,attachments,sources,feedback,
            status,model,mode,version,created_at }] }
     PATCH  /conversations/:id { title?,pinned?,archived?,mode?,model? } -> { conversation }
     DELETE /conversations/:id                    DELETE /conversations (all)   GET /conversations/export
     POST   /conversations/:id/messages { content, attachment_ids }         -> text/event-stream
     POST   /conversations/:id/messages/:mid/regenerate                     -> text/event-stream
     POST   /conversations/:id/messages/:mid/edit { content }               -> text/event-stream
     POST   /conversations/:id/messages/:mid/stop                           (Stop also closes the stream)
            SSE events (core/sse.js): user {message,conversation} · start {message} · delta {text}
            · sources {sources} · done {message} · error {code,message}
            Research mode (v0.5.3) also sends, before the first delta:
            status {stage:'searching'|'reading'|'writing'|'unavailable', count?}
            · sources {sources:[{n,title,url,site,snippet}]}
            Error codes: 'no_provider' (no AI provider configured), 'quota' (daily limit), 'provider_down',
            'no_vision'.
     POST/DELETE /conversations/:id/share -> { share:{ token,url } }        GET /shared/:token (read-only, public)
     POST   /conversations/:id/notes { content, sources, origin, title } (adds an assistant note, e.g. an AI
            Browse summary)
     POST   /messages/:id/feedback { rating:'up'|'down', reason?, comment? }
     POST   /uploads (multipart: file) -> { attachment:{ id,name,type,size,kind } }
     DELETE /uploads/:id    GET /uploads/:id/file
            Limits enforced server-side too: images 10 MB, PDF/docs 20 MB, text 2 MB, 5 files per message.
     GET    /chat/settings   PATCH /chat/settings { ... }   GET /chat/stats
     POST   /chat/guest { messages:[{role,content,attachments}], mode, model, language } -> text/event-stream
            (nothing saved)
     POST   /chat/guest/extract (multipart: file) -> { attachment:{ id,name,kind,text,... } } (read once, not stored)
     POST   /study/cbt { subject, topic, exam, language, avoid? } -> { questions:[{ q,options[4],answer,explanation }],
            durationSec, count, exam, examLabel, subject, topic } (CBT practice test, v0.5.7; Preview: 'offline')
   Account profile (name, reply language) uses the EXISTING PATCH /account/profile. */

import { RemoteChatData } from './api-client.js';
import { DEFAULT_SETTINGS, LIMITS, classify } from './common.js';
import { GuestChatData } from './guest-client.js';
import { LocalChatData } from './storage.js';
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

function pref() { try { return window.COLON_DATA || window.localStorage.getItem('colon.data') || 'auto';
  } catch (e) { return 'auto'; } }
// auto: API reachable → your account (Remote) or a guest chat (Guest); API down → on-device Preview (Local).
function pick() {
  var p = pref();
  if (p === 'local') return 'local';
  if (p !== 'remote' && !C.online) return 'local';
  return C.user ? 'remote' : 'guest';
}
var instance = null;
const ColonChatData = {
  get: function () {
    if (!instance) { var k = pick(); instance = k === 'remote' ? RemoteChatData() : k === 'guest' ? GuestChatData(
      ) : LocalChatData(); }
    return instance;
  },
  pick: pick, LIMITS: LIMITS, classify: classify, DEFAULT_SETTINGS: DEFAULT_SETTINGS
};
window.ColonChatData = ColonChatData;

export { ColonChatData };
