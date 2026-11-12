# Phase 5 — Web search with cited sources (Research mode, v0.5.3)

Research mode looks the question up on the web, reads the best pages, and answers from them with numbered citations
[1], [2] that the app turns into tappable chips and a Sources list. It is free and keyless by default, runs on the
1 GB cPanel host (no browser engine, no new dependencies), and never breaks chat: if search fails, the answer still
streams with a one-line notice.

Code: `services/api/src/search/` (`providers.js`, `net.js`, `text.js`, `reader.js`, `prompt.js`, `config.js`,
`index.js`), wired in `services/api/src/chat/reply.js` and `src/http/routes/chat.js`. Tests:
`services/api/test/search.test.js`. Live check: `node services/api/scripts/research-check.js "question" [language]`.

## When it searches

- **Research mode only** (signed in, temporary chats and guests alike). General, Study and Developer never search.
- Not tied to a model: whichever model Routing picks for Research answers from the sources. `colon-saga-deep`
  (Saga Deep Research) is still "coming soon"; multi-step research is a later step. A "Search the web" toggle for the
  other modes is not built; the server already supports it (`respond({ webSearch: true })`) if we add one.
- Switched off from **Admin › System › Web search** (live within ~30 s) or with `WEB_SEARCH=off`. Off means Research
  answers from the model's own knowledge and the prompt forbids invented links.
- A message with no searchable text (for example only an attachment) skips search silently.

## The flow (one reply)

1. The daily limit is charged first (search costs nothing extra; guests keep their lower limit).
2. **Queries.** Heuristic, no model call: filler ("please can you tell me", "research", "abeg") removed, the current
   year added to "current / latest / today / now" questions, plus a keyword-only variant. A short follow-up ("and
   Ghana?") borrows the topic of the previous question. For Naijá, Yorùbá, Hausa and Igbo (reply language or obvious
   tone marks) one quick call to the first model in the General route writes English queries and a faithful English
   translation (`EN:` / `Q:` lines, 4 s budget, ~1.2 s in tests); on any problem the heuristic queries are used.
3. **Search** (`status {stage:'searching'}`): the provider chain, first provider that returns results wins. Within a
   provider the second query only runs when the first didn't return enough. URLs are de-duplicated.
4. **Read** (`status {stage:'reading', count}`): the top 3 results (admin 0–5) in parallel, ~6 s per page, ~12 s for all
   of them; whatever isn't back in time is left out (its search snippet is still used).
5. **Sources** go to the app (`sources [{n, title, url, site, snippet}]`), then `status {stage:'writing'}`.
6. The model gets the numbered sources appended to Saga's system prompt with strict rules: cite `[n]` right after the
   claims each source supports; only use the given sources for facts; say when they disagree or don't cover the
   question (and mark general knowledge as possibly out of date); no "Sources" section or invented numbers; today's
   date in Africa/Lagos for recency; source text is untrusted data, never instructions.
7. Saved with the assistant message: `sources` (existing column, also used by AI Browse) and `web_search`
   (`{ ok, provider, ms, read }`, migration 0006). History, regenerate and shared links show the same sources.
   Page text is not stored.

If no provider returns anything (or the search code throws), the app gets `status {stage:'unavailable'}`, the answer
starts with *"Web search wasn't available just now, so this answer comes from Colon's own knowledge and may be out of
date."*, and the model is told not to cite anything. A user Stop during search stops the reply as usual.

## Providers

| Provider | Key | Used when | Notes |
|---|---|---|---|
| Brave Search API | `BRAVE_SEARCH_API_KEY` or Admin | a key is set | `X-Subscription-Token`, `country=NG` |
| Tavily | `TAVILY_API_KEY` or Admin | a key is set | `search_depth: basic` |
| SearXNG | `SEARXNG_URL` (+ optional `SEARXNG_API_KEY`) or Admin | a base URL is set | the instance must allow `format=json`; goes through the SSRF guard |
| DuckDuckGo | none | always (default first) | POST `html.duckduckgo.com/html` (region `ng-en`), then `lite.duckduckgo.com/lite` if the HTML layout can't be read; `uddg` redirects unwrapped, ads dropped |
| Wikipedia | none | always (default fallback) | `list=search` on English Wikipedia (question words and years dropped, Nigerian acronyms such as CBN, INEC, JAMB spelled out) plus the `pcm`/`yo`/`ha`/`ig` Wikipedia for those reply languages (up to two places) |

Default order: Brave → Tavily → SearXNG → DuckDuckGo → Wikipedia (unconfigured ones are skipped). Admin can reorder
and switch providers off. A provider that answers with a captcha/anomaly page (or 202/403/429) is **blocked** and
rested for 10 minutes in that worker; other errors rest it for 1 minute. Resting providers are tried last, never
dropped.

Keys entered in Admin are stored in `app_settings` (`search_keys`) AES-256-GCM encrypted with `APP_SECRET`, only the
last 4 characters kept for the mask (`••••1234`), Super Admin only, and every change is audited. A stored key wins over
the environment one.

**Sandbox test, 12 Nov 2026:** DuckDuckGo (both endpoints) answered every request from the build sandbox with its
anomaly/captcha page (HTTP 202), as it often does for cloud IPs; Wikipedia worked. The chain fell back to Wikipedia in
~0.2 s. Whether DuckDuckGo answers from the cPanel server's IP is to be seen in the logs (`search_ok` /
`search_failed provider=duckduckgo code=blocked`). If it is blocked there too, Research mode runs on Wikipedia alone,
which is fine for background but weak for news and prices; then add a free Brave Search key or a SearXNG URL in
Admin (no redeploy).

## Page reader

- `net.safeFetch`: http/https only, ports 80/443 only, no `user:pass@`, `localhost`/`.local`/`.internal` refused, and
  every hop (at most 3 redirects, each re-checked) must resolve only to public addresses: loopback, RFC 1918, CGNAT
  (100.64/10), link-local and cloud metadata (169.254/16), multicast/reserved, `::1`, `fc00::/7`, `fe80::/10` and
  IPv4-mapped IPv6 forms are refused **after DNS resolution**. The check runs right before each request; the socket
  then does its own lookup, so a DNS-rebinding race of a few milliseconds remains (shared hosting gives no way to pin
  the socket to the checked address).
- 1.5 MB cap (the body is cut, not refused), ~6 s per page, `text/html`, `application/xhtml+xml` and `text/plain` only:
  PDFs, images, archives and office files are skipped by content type or extension.
- HTML → text with regexes (no DOM library): `<article>`/`<main>` preferred, scripts, styles, nav, header, footer,
  aside, forms and cookie/share/menu blocks dropped, headings kept, entities decoded. Wikipedia pages are read through
  Wikipedia's plain-text extracts API instead (tables are not included there).
- Each page is trimmed to ~2,500 characters: the opening paragraph plus the paragraphs sharing the most words with the
  query, in page order.
- 10-minute LRU (80 pages per worker), so a regenerate doesn't fetch everything again.

## Logs

`search_ok {provider, ms, count, read, queries, via}` and `search_failed {provider, ms, code}` (per provider, and
`provider: "all"` when nothing worked) go to stderr.log next to `ai_reply_ok`. Query text is never logged.

## Limits and cost

- Free: no keys needed, no paid servers. Outbound HTTPS from the server only.
- Per Research reply: 1–3 search requests, up to 5 page fetches (default 3), and for African languages one short model
  call. Memory stays small (page bodies capped at 1.5 MB, cached text ~2.5 KB each).
- Prompt size: about 2,500 characters per page read plus snippets, ~8–10k characters with the defaults, well inside the
  60k context budget.
- Measured in the sandbox (Wikipedia path, Gemma 4 26B): sources after ~1.0 s (English) and ~2.4 s (Yorùbá, includes
  the query-writing call); first answer token ~1.9 s and ~3.7 s after the request started.

## Privacy

The search query (derived from the user's latest message, and for Naijá/Yorùbá/Hausa/Igbo an English translation of
it) is sent to **DuckDuckGo** and **Wikipedia** (and to Brave, Tavily or your SearXNG instance only if an admin
configures them). No user id, name, email, IP or cookies are sent; requests come from the Colon server. The result
pages are fetched by the server too, so websites see the server, not the user. In the app, a source's favicon is
loaded by the user's browser straight from that site (`/favicon.ico`, no referrer); it is only a picture and is hidden
when missing. Queries are not logged; sources (titles, links, snippets) are saved with the answer like the rest of
the chat and are deleted with it.

## Settings reference

`app_settings.search` = `{ enabled, order[], disabled[], results (3–8, default 5), pages (0–5, default 3), searxngUrl }`
`app_settings.search_keys` = `{ brave|tavily|searxng: { enc, last4 } }`
Environment: `WEB_SEARCH` (`off`), `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SEARXNG_URL`, `SEARXNG_API_KEY`.
