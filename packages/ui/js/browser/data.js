/* ColonBrowserData: the ONE data adapter for browser state, shared by Colon Browser and the
   browser panel inside Colon AI (same session infrastructure, ROADMAP Phase 8/10).

   Two implementations with the same interface:
   - LocalBrowserData (default today): IndexedDB on this device + a web "reader preview" that loads
     pages from sources that allow cross-origin reads (Wikipedia). Each subdomain keeps its own copy.
   - RemoteBrowserData: the endpoints below on api.apparatus.name.ng. Switch with
     localStorage['colon.data'] = 'remote' (or window.COLON_DATA = 'remote') once the API serves them;
     the session is then shared by every app and device of the signed-in user.

   Expected API endpoints (not served by the API yet; all JSON, cookie session + X-Colon-Client):
     GET /browser/session -> { session: { tabs:[{id,url,title,back:[],fwd:[]}], active_id, control } }
     PUT    /browser/session   { session }      -> { session }
     GET /browser/bookmarks -> { bookmarks:[{id,url,title,folder_id,created_at}], folders:[{id,name}] }
     POST   /browser/bookmarks { url,title,folder_id } -> { bookmark }
     PATCH  /browser/bookmarks/:id { title?, folder_id? }   DELETE /browser/bookmarks/:id
     POST   /browser/folders { name } -> { folder }   PATCH /browser/folders/:id { name }   DELETE /browser/folders/:id
     GET    /browser/history?q=&limit=          -> { history:[{id,url,title,visited_at}] }
     POST   /browser/history { url,title }      DELETE /browser/history/:id   DELETE /browser/history (clear)
     GET    /browser/downloads                  -> { downloads:[{id,name,type,size,url,status,created_at}] }
     POST   /browser/downloads { url,name }     DELETE /browser/downloads/:id   GET /browser/downloads/:id/file
     POST /browser/uploads (multipart file) -> { upload:{id,name,type,size,status} } GET/DELETE /browser/uploads[/:id]
     GET    /browser/settings  PATCH /browser/settings { ... }
     GET    /browser/fetch?url=                 -> { url, final_url, title, html (server-sanitised), text, status }
            (the web light-mode reader, reader-proxy.js; full contract in docs/phase8-backend-contract.md)
            Server must: allow http/https only, resolve DNS and refuse private/loopback/link-local/metadata
            IPs (re-check after every redirect, max 5), cap 2 MB and 10 s, strip scripts/styles/iframes/forms.
     GET    /browser/search?q=&engine=          -> { results:[{title,url,snippet}], provider }
     POST   /browser/plan { goal }              -> { steps:[{kind,label,query?,url?}] }   (Colon Saga planner)
     POST   /browser/data/clear { history,downloads,bookmarks,session } */

import { DEFAULT_SETTINGS } from './data-common.js';
import { LocalBrowserData } from './data-local.js';
import { RemoteBrowserData } from './data-remote.js';
import { createProxyReader } from './reader-proxy.js';
import { sanitize } from './sanitize.js';
import { wikiLang } from './wikipedia.js';

function mode() { try { return window.COLON_DATA || window.localStorage.getItem('colon.data') || 'local';
  } catch (e) { return 'local'; } }
var instance = null;
// Pages that block cross-origin reads go through the server-side reader when it exists (reader-proxy.js).
function get() { if (!instance) instance = createProxyReader().wrap(mode() === 'remote' ? RemoteBrowserData()
  : LocalBrowserData()); return instance; }

const ColonBrowserData = { get: get, sanitize: sanitize, DEFAULT_SETTINGS: DEFAULT_SETTINGS, wikiLang: wikiLang };
window.ColonBrowserData = ColonBrowserData;

export { ColonBrowserData };
