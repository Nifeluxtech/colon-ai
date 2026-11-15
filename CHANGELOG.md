# Changelog

## [0.11.6] — 2026-11-15 · Saga login wait never sticks
Owner's report on 0.11.5 (Android): Saga was asked to log in to yolotask (the reviewer sign-in page). signIn answered
`no_login`, Saga showed the Colon Secured Login form and waited for Give back; the user filled it and SAVED it, and
Saga stayed stuck, and the next chat messages ("Login n", "Hi") got no reply at all. Three causes: the phone sent
Give back (`return_to_ai`) only when its card was already in `needs_user`, a state that arrives asynchronously from
the control state (or never, when it was lost), so the server waited the whole `SAGA_HANDOFF_TIMEOUT_MS`; every
message typed while a task was live was only queued for "Saga's next step", which never came while it waited; and a
saved login matched its exact host only. Every version number moves to 0.11.6 (apps, `Colon.version`, `?v=`
cache-busting, `version.json` versionCode 1106 for both APKs, the API's package.json and package-lock). No migration,
no new config key.
### Fixed
- **Saving the login form always resumes Saga** (Android `LoginWait`, `ChatBrowserPanel`, `MainActivity`). After the
  form of a login hand-over, Give back goes to the server whatever the card shows, with "Login saved for <site> in
  Colon Secured Login" (or "I didn't save a login."); a lost control state is put back first (0.10.4's
  `restoreWaiting`). A form whose callback was lost (the screen was rebuilt while it was open), a login saved from
  another form (the chat's card), and the app coming back with the login now in the vault resume it too.
- **Saga signs in at once** (`saga/saved-login.js` `forLoop().form`, `loop.js`): when Saga's own signIn answered
  `no_login`, the form's "Login saved" note (or a bare Give back) sends `sign_in` again straight away, with no model
  step in between; a closed form hands the sign-in to the user ("Sign in to <site> yourself…, then give it back").
  Only "I didn't save a login." skips the retry.
- **Server safety net** (`saga/login-wait.js`, `browser/bridge.js`, `control.js`, `frames.js`, `runner.js`): while
  the loop waits on the login form (hand-over kind `login`), a login saved on the phone through any path the bridge
  sees ends the wait: control `login_saved {site}` (a Give back with the saved note), or a "Login saved for …" note
  on any control frame, also one up to a minute before the wait began. When Saga lost control meanwhile it asks for
  it again the usual way.
- **Messages while Saga waits get a reply** (`apps/chat/src/lib/saga-route.js`, `actions/saga-wait.js`,
  `send-message.js`, `browser-chat.js`). While Saga waits for the user (the login form, a hand-over, Take control, a
  pause; from the card's state or the server's task status, whichever knows first) a message is a normal chat turn.
  "continue", "login", "try again", "I've saved it", "done"… carry Saga on (`return_to_ai` with the user's words; the
  phone turns them into "Login saved for <site>" when its vault has the login, so Saga signs in at once; `resume`
  after a pause) and "stop" / "cancel" stop it. The browse tool called meanwhile carries Saga on with its task as the
  user's words. While Saga works, messages still steer its next step (`guide`), now kept in the thread with a visible
  line instead of a toast only; `POST /browser/agent/:id/guide` answers 409 `waiting` while the task waits, and the
  app sends the message to the chat model instead. The chat model's browser state says "Saga is WAITING for a login
  on <site>" (or for the user, or paused) with what the user can say (`chat/browser-state.js` `task.waiting`).
- **A saved login matches its domain family** (Android `VaultRules.match`, `registrable`, `sameFamily`;
  `LoginVault.find`): the site's own entry, else the closest parent domain's (longest wins: a login for
  yolotask.com.ng signs in on reviewer.yolotask.com.ng), else a subdomain's when the parent is asked for (shortest,
  then newest); never a sibling, never across registrable domains (com.ng, co.uk… are suffixes). `pageMatches` stays
  https-only and on the same registrable domain (and no longer accepts a bare suffix as a site). The form edits the
  exact entry (`LoginVault.exact`); the one-time approval is stored on the entry's own site. No site-specific rules.
- **The waiting card and note show what to do**: the card's pill (and the chat's card header, control `login`) offers
  **Save login** (reopens the form: `browser('control', {op: 'login_form'})`, app feature `loginWait`) and Stop; the
  thread note "Saga is waiting for a login" has [Open the login form] · [Stop Saga] links (`#colon-login`,
  `#colon-stop`), and a hand-over note has Stop.
- Tests: `saga-login-wait.test.js` (end to end on the bridge: `login_saved` ends the wait and Saga signs in at once,
  the safety net on another control frame, a closed form hands the sign-in over, a bare Give back, guide 409 while
  waiting, the browser state), `saga-0110.test.js` (signed in at once after the form), `saga-route.test.js` (routing
  while waiting vs working), `card-chrome.test.js` (the login control); Android `VaultRulesTest` (domain matching),
  `LoginWaitTest` (Give back whatever the card shows, notes, the login pill).

## [0.11.5] — 2026-11-15 · Browser follow-ups via tool routing: the chat model decides when to browse
Owner's spec: after a browser task, follow-ups like "go to Colon repo", "open it", "click the second one" or "check my
orders" often went to plain chat instead of Saga, or Saga handed the step back to the user, because routing was guessed
from keywords (`apps/chat/src/lib/browser-intent.js`, `services/api/src/modules/chat/browse-follow.js`). Now: one
model, with the browser as a tool. Every version number moves to 0.11.5 (apps, `Colon.version`, `?v=` cache-busting,
`version.json` versionCode 1105 for both APKs, the API's package.json and package-lock). No migration. New config keys
(all optional): `CHAT_BROWSER_TOOLS`, `CHAT_TOOL_MODEL`, `CHAT_TOOL_FALLBACK_MODEL`, `CHAT_TOOL_TIMEOUT_MS`.
### Changed
- **The chat model has browser tools** (`modules/chat/browser-tools.js`, `modules/ai/tool-call.js`). Gemini function
  declarations on every turn, in every specialist mode (the mode and its instructions never change):
  `browse(task, item?, url?)` starts or continues Saga in this chat's browser session (SSE `browse`, the app's live
  card opens under the user's message every time), `read_page()` answers from a short summary of the current page,
  `stop_browsing()` closes the browser (SSE `browser {op: 'close'}`). Google AI Studio's native
  `streamGenerateContent` with tools: `CHAT_TOOL_MODEL` (default gemini-3.5-flash-lite), then
  `CHAT_TOOL_FALLBACK_MODEL` (default gemma-4-26b-a4b-it: Gemma 4 supports native function calling on the Gemini API,
  ai.google.dev/gemma/docs/core/gemma_on_gemini_api). Text streams as the reply; function calls keep their Gemini 3
  `thoughtSignature` for the next round. A turn that only browses keeps no assistant message (`done {dropped}`).
- **Browser state in context** (`modules/chat/browser-state.js`). When the chat has a browser session (the page the
  app sent, or a Saga task in this chat within 6 hours), the system prompt holds, fenced as untrusted: the URL and
  title, signed-in status (0.11.4's `signed-in.js` check on the page read), the last task and its last 5 steps (one
  line each; Saga's step lists are still never fed back as text), a page summary (≤ 1,500 characters) and the visible
  clickable items, numbered. `browse` with `item: n` gives Saga that item's text and address.
- **Keyword routing is only the fallback.** The app reads only the browser's own controls when signed in (open / close
  the browser, stop, take control, done, continue: `ctx.tools`); everything else goes to the chat model. The server's
  `browse-follow.js` (now also with 0.11.2's `needsBrowser` as `starts`) decides only when both tool models fail (no
  key, quota, errors before any text); the reply then comes from the usual `AI_MODEL_SET` chain, so nothing is worse
  than 0.11.4. `CHAT_BROWSER_TOOLS=off` restores the 0.11.4 routing.
- **Better page reading** (Android, `assets/saga/summary.js`, feature `pageSummary`, bridge action `page`): Mozilla
  Readability 0.6.0 (Apache-2.0) picks the main content and Turndown 7.2.5 (MIT) turns it into Markdown, both injected
  into the WebView in one function scope; pages that are not articles use the visible text of `<main>`. Each message
  carries it (`POST …/messages` `browser`), within 1.5 s.
- **Cookie banners clear with no model call** (Android, `assets/saga/consent.js`): Consent-O-Matic's rules (MIT, a
  curated 51 of ~200: the common consent platforms and big sites; detectors and reject methods only, built by
  `scripts/vendor-consent-rules.js`) run before Saga reads a page, rejecting every category and saving; Saga is told
  ("Colon closed a cookie banner"). The 0.11.2 pop-up handling ("Reject all" by Saga) stays the fallback.
- **Saga acts.** A finish that tells the user to tap, click or open something ("tap it yourself", "you'll need to
  click…", "Tap the repo to open it") is refused and sent back as an observation every time, also after the 3 usual
  refusals (the step limit still applies). `requestUserControl` is only for a password, code, card or PIN field, a
  captcha, a payment or a consent frame Colon can't read; "other" on a page without a secret field is refused. The
  prompt says so.
- **Vendored code** lives in `apps/android/app/src/main/assets/saga/vendor/<name>/` with its LICENSE file.
  `scripts/check.js` exempts `vendor/<name>/` from the size rules only (still syntax-checked) and fails when a vendor
  directory has no LICENSE (new rule 6).
- Tests: `chat-browser-tools.test.js` (GitHub → "go to Colon repo", Jumia → "open the second one", yolotask →
  "check my tasks", Developer mode chat vs browse, "in the logged in account", read_page / stop_browsing, the keyword
  fallback), `chat-tool-call.test.js` (native function calling, fallback model, a whole browse reply),
  `saga-acts.test.js` ("tap it yourself", hand-overs), `saga-phone-consent.test.js` (consent.js, summary.js, the
  vendored files), `browser-intent.test.js` (`ctx.tools`).

## [0.11.4] — 2026-11-15 · Saga no longer asks you to sign in when you already are
Owner's report on 0.11.3 (phone screenshot): "Login to GitHub" with github.com already signed in (the dashboard,
"Good evening, Nifeluxtech!", the repositories listed, no login form) ended with "Saga needs you: Your saved login
didn't get you in here. Sign in yourself (or enter the code), then tap Return to AI." Every version number moves to
0.11.4 (apps, `Colon.version`, `?v=` cache-busting, `version.json` versionCode 1104 for both APKs, the API's
package-lock). No migration, no API change, no new config key.
### Fixed
- **A sign-in was handed to the user on a signed-in page.** Saga called signIn on the dashboard; the phone's fill
  script found no login form there and answered `no_form`. The loop had already marked the site as "saved login
  tried", the answer reached Saga as a plain failure, and Saga's next sign-in request (requestUserControl) went
  straight to the hand-over with "your saved login didn't get you in" (`saved-login.js` `handoffMessage` only looked
  at the tried set, never at the page). Now (any site, `modules/saga/signed-in.js`):
  - the page is read before a sign-in hand-over and checked for a signed-in account: no password / code / card / PIN
    field, not a /login page, and an account or avatar menu, Sign out / Log out, "Signed in as …" or a greeting with a
    name (a greeting or account menu counts only when no Sign in / Log in button is shown);
  - already signed in: no saved login and no hand-over; a goal that is only "log in to <site>" ends as done with
    "You're already signed in to github.com as Nifeluxtech.", any other goal carries on (Saga is told);
  - `no_form` is not a failed login: the site is not counted as tried, and Saga is told to open the sign-in page;
  - a sign-in is handed over only when the page holds a secret field or is a sign-in page (after 2 refusals Saga may
    still hand over, with the plain message); "your saved login didn't get you in" only with a secret field there;
  - the finish check accepts a sign-in goal on a signed-in page ("go to GitHub and log in" on the dashboard).
- Tests: `saga-already-signed-in.test.js` (GitHub dashboard, Jumia account page, yolotask.com.ng dashboard, Google
  Account page; a real login form with the saved login, and the hand-over only when it fails).

## [0.11.3] — 2026-11-15 · Follow-ups keep Saga working in the same browser
Owner's report on 0.11.2 (Infinix SMART 20, Developer mode): "Login to GitHub" worked, then "Go to Colon repo",
"In the logged in GitHub account", "Open the browser and check", "Go to the repository named colon ai" were answered
by the chat model ("provide the full URL"), with no browser and no card, and "Open the colon ai repository" ended
with "if you can see it, tap on it". Every version number moves to 0.11.3 (apps, `Colon.version`, `?v=`
cache-busting, `version.json` versionCode 1103 for both APKs). No migration, no new config key; one new SSE event.
### Fixed
- **Follow-ups went to the chat model.** The chat only sent narrow commands to Saga ("go to <domain>", "search
  for…"); "go to Colon repo" named no domain or "site" word, so it fell through to Developer mode's model, which
  then imitated Saga's step lists from the history. Now, after a browser task in a chat (any site), a message that
  plausibly continues it is a Saga task in the same browser session (`browser-intent.js` `followUp`): open / go to /
  click / select / scroll / next / more, check / find / look for / read, "that one", "the second result",
  "continue", "open the browser and check…", and a fragment like "in the logged in account" (read with the
  previous message). Code and explain requests stay chat. The chat's specialist is kept: a browsing follow-up in
  Developer mode is Developer + AI Browse. The follow-up continues the last task (`continue_of`), so Saga starts from
  what it already did, on the page it left.
- **Server-side guard.** `POST /conversations/:id/messages` sends the same follow-ups (a browser turn among the last
  6 messages) back to the app as SSE `browse {goal, message_id}` instead of calling the model
  (`modules/chat/browse-follow.js`), so routing no longer depends on the page alone. Saga's step lists are left out
  of the chat model's history.
- **No live card on follow-ups.** They never reached Saga; every follow-up now runs through the 0.11.2
  ensureChat / open path and shows the live card under the user's message (also for the server's `browse`).
- **Saga talked instead of acting.** A finish that asks the user to tap or click something Saga could do, or that
  only narrates ("I am attempting…"), is refused; a "go to / open <name>" goal needs that name in the page's address
  or title, matched loosely on any site ("colon ai" = colon-ai = colon_ai = ColonAI; a search results page doesn't
  count). Refusals before a finish is accepted: 3 (was 2). The rules, written out for Gemini 3.5 Flash-Lite: do the
  clicking, find loosely named things in elements → getLinks → scroll → site search → a guessed address, state the
  outcome in the past tense, and try at least 3 ways before giving up.

## [0.11.2] — 2026-11-14 · Saga clears pop-ups first, works faster, and Minimise really minimises
Owner's report on 0.11.1 (Infinix SMART 20, Colon AI app). Every version number moves to 0.11.2 (apps,
`Colon.version`, `?v=` cache-busting, `version.json` versionCode 1102 for both APKs). No migration, no API change,
no new config key.
### Fixed
- **Saga couldn't get past pop-ups** (Google's "Before you continue to Google" cookie dialog: Saga kept pointing at
  a result behind it, "I'm checking the current search results…", and got nowhere). The page snapshot listed
  elements in document order and stopped at 60, so the dialog's buttons (at the end of the page) were never seen,
  nothing said the results were covered, and the prompt told Saga that a cookie choice was the user's to make. Now
  the phone finds the topmost pop-up (new `assets/saga/overlay.js`: open `<dialog>`, role dialog / alertdialog,
  aria-modal, consent iframes such as consent.google.com, and fixed boxes on top at a few points of the screen,
  checked with `elementFromPoint`; a full-screen app shell is not one). `content` lists the pop-up's elements first
  (`in_popup`), marks what it covers (`blocked`, at most 15 of them) and says `overlay {label, kind, frame}`; `point`
  / `click` refuse an element behind it (`error covered`) before the pointer moves or anything is tapped. The server
  shows the pop-up to the model, refuses a click or fill on a blocked element without a round trip, explains a
  refused tap, and the rules say: pop-ups first; for cookie or consent banners "Reject all" / "Only necessary" /
  close unless the user asked to accept; a consent frame Saga can't read goes to the user (requestUserControl).
  A pop-up's decline or close button needs no approval (same list in `overlay.js` and `policy.js`, only inside a
  pop-up); "Accept all" in a form still asks. Secret-field refusals are unchanged and checked first.
- **Saga was slow.** Per step it waited for a model call that only said "getPageContent" after every page change,
  then a fixed 0.7 s after each tap (1.9 s when the page answered late), and load polls of 0.75 s. Now: the server
  reads the page for Saga after any step that opens, changes or scrolls it, or submits a fill, in every mode
  (`autoRead`, was speed mode only): one model call fewer per page change, typically 2–6 s each on Gemma's free
  tier; the tap's outcome is read at 150 / 350 / 700 ms and the wait ends at the first change (`SagaTap.QUICK_LOOKS_MS`:
  most taps save ~0.4–0.5 s); load polls every 350 ms (up to ~2.8 s); the screenshot tool is no longer offered (its
  picture never reached the model, so each one was a wasted step); page text from the phone is capped at 8,000
  characters (the server uses 6,000) and a pop-up's page behind it at 15 elements. Thinking stays `minimal`.
- **Minimise in full screen did nothing.** The full-screen view is placed exactly, outside `InlineSteady`, which
  still remembered the card's box as applied; on Minimise the card's box was "no move" (same as before), so the
  panel stayed full size with the card's "expand" button and no top bar (the owner's screenshot). Full-screen
  placements are now recorded (`InlineSteady.placedElsewhere`), so the card's box is applied again at once; a chat
  switch out of full screen re-places the panel too.
### Added (owner's later requests on 0.11.2)
- **Saved login first.** Before Saga hands a password field or sign-in page to the user, the server sends
  `sign_in {site}`: the phone fills the login saved for that site (Colon Secured Login, `LoginVault`) on a trusted
  https page after the user's one-time approval; with no login saved, the chat's Colon Secured Login form card is
  offered first and Saga signs in as soon as one is saved. "Take control" runs only when that doesn't get Saga in
  (form closed, untrusted or wrong site, fill failed, no `sign_in` capability, or a login already tried on this site
  in this task, such as a wrong password or a one-time code). Codes, cards and PINs are never tried
  (`modules/saga/saved-login.js`; the phone defers its own hand-over with `saved_login`).
- **Saga's pointer stays on while it works**, not only at a tap: shown on every command while Saga has the page,
  gliding between targets (longer trips take longer) and floating gently near the last one while Saga thinks or a
  page loads; still hidden on a secret field, Take control, Pause, Stop and when the task ends (`SagaPointer`).
- **Messages that need the browser open it by themselves** (`browser-intent.js` `needsBrowser`): a live web search
  ("search for…", "google…"), checking or visiting a named site or domain ("check yolotask"), signing in, filling a
  form, comparing prices, buying / booking / finding on a named site, and a question about a named site's live data
  ("how much is rice on jumia?"). Ordinary questions stay chat.
- **Past browser runs keep their cards for good, and the card is redesigned.** Every finished run stays under its
  message with its last picture and a summary row (site icon, domain, "Done · 5 steps" / "Stopped" / "Couldn't
  finish"); tapping it opens that run's steps (the app's timeline for the run it still holds, else the server's step
  list in a sheet). A chat keeps up to 200 cards and 60 pictures (was 20 / 6); a card past the picture caps keeps its
  summary row. Only the newest run's picture gives way to the live browser under the same message; an older run's
  card is never removed. The newest 8 pictures come with the card list, older ones one at a time
  (`browser('cardShot')`). The live card now has a slim header (site icon and domain, a status dot or spinner, a
  short task title, small icon buttons: Full screen / Minimise, Take control / Give back, Pause / Resume, Stop) and
  one status line under the page that crossfades between Saga's steps, light and dark from the Colon tokens
  (`lib/card-chrome.js`, `components/browser-chrome.js`, `chat-saga-card.css`). The page tells the app
  (`browser('chrome')`, feature `browserChrome`) so the big dark pill and corner button no longer float over the
  page in the thread; full screen keeps its top bar, pill and Minimise (`ChatCardRules.floating`). New bridge actions:
  `chrome`, `timeline`, `cardShot`.
### Tests
- `services/api/tests/security/saga-phone-overlay.test.js` (new fake DOM with stacking, `tests/helpers/fake-dom.js`),
  `tests/unit/saga-popups.test.js`, `saga-runner.test.js` (autoRead), `saga-saved-login.test.js`;
  `packages/ui/test/card-chrome.test.js` (new: header, buttons, status line, summary row, steps, 200 past cards kept),
  `browser-intent.test.js` (needsBrowser), `browser-opener.test.js` (an older run's card is never erased); Android
  `InlineSteadyTest`, `FocusRulesTest` (minimise round trip, a clear page under the chat's chrome), `SagaTapTest`
  (quick looks, pointer glide), `ChatRunTest` (card caps, steps and site round trip).

## [0.11.1] — 2026-11-14 · The browser card appears where you opened it, and full screen has a way back
Owner's report on 0.11.0 (Infinix SMART 20, Colon AI app). Every version number moves to 0.11.1 (apps,
`Colon.version`, `?v=` cache-busting, `version.json` versionCode 1101 for both APKs). No migration, no API change.
### Fixed
- **"Open browser" showed no card until you left the chat and came back.** The page told the app which chat is on
  screen (`browser('chat')`) once per chat and never again, so when that call was lost or the app switched chats by
  itself, every state named another chat and `liveHere` hid the card. The page now checks each state against the
  chat on screen and tells the app again (at most twice per chat, one call at a time: `needsChatResync` in
  `lib/native-panel.js`, `healChat` / `ensureChat` in the new `components/browser-chats.js`), and every open from
  the chat (the instruction, the Browser button, `openBrowser`) makes sure the app shows this chat's browser first.
  The card shows at once under the instruction, moves under the reply when it lands, and the anchor reports again
  (`createAnchor().force()`).
- **The card came back at the bottom of the thread, next to an old task's picture (a duplicate).** The reply that
  opened the browser was kept in memory only and dropped whenever the chat changed, so after coming back the live
  card fell back to the last task's message (beside that task's "Done" picture, whose id didn't always match the
  task) or to "now", which followed every new message to the bottom. It is kept per chat in the page's storage now
  (`lib/browser-opener.js`), and `liveSpot` (`lib/saga-card.js`) places the card: a running task keeps its message;
  an idle browser goes under the reply that opened it; after a task ended it takes that task's place and replaces
  its picture (`layout(…{ replaces })`), so there is one browser card per chat; never "now".
- **Full screen had no way back to the card.** The corner button stays in full screen as **Minimise** (where the
  finger already is), beside the top bar's "back to the chat"; the phone's **Back** collapses full screen first,
  also in the stacked FULL layout, where 0.11.0 walked the page's history first and the card's collapse did nothing
  because it only checked the inline view (`FocusRules`, `ChatBrowserPanel.setFocus` / `handleBack`). The app's
  `focus` state covers both layouts, and the page re-reports the card's box when full screen ends, so the card is
  re-attached in place; the overlay watch and steady scrolling work as before.
### Tests
- `packages/ui/test/browser-opener.test.js` (opener store, `liveSpot`, `layout` replaces, `needsChatResync`),
  `native-anchor.test.js` (`force()`), Android `FocusRulesTest`.

## [0.11.0] — 2026-11-14 · Saga grows up: timeline, Colon Secured Login, approvals, background, schedules
Every version number moves to 0.11.0 (apps, `Colon.version`, `?v=` cache-busting, `version.json` versionCode 1100
for both APKs). **Migration `0011_saga_schedules_routines.sql`** (scheduled checks and routines). Design and limits:
[ADR 0007](docs/decisions/0007-phone-vault-and-scheduling.md).
### Added
- **Step timeline**: tap the browser card (or ⋮ › Steps) for every step Saga took, with a small picture of the page
  after it. Typed values that look secret (password fields, password-like strings, card numbers) show as
  `•••• (n characters)`; pictures stay on the phone (`StepLog`, `TimelineSheet`).
- **Colon Secured Login**: saved site logins live only in the phone's vault (Android Keystore AES-GCM,
  `LoginVault`), entered in a native secure form (`LoginFormActivity`, `FLAG_SECURE`, no autofill to the page).
  Saga's `signIn {site}` makes the phone fill the page itself (`assets/saga/login.js`) on a trusted **https** page of
  that site after the user's one-time approval; the server and the model see only `{site, login_saved}` and
  ok / `no_login` / `not_trusted` / `wrong_site`. Settings › Saga › Saved logins (`VaultActivity`) lists and deletes
  them. In the chat, "save my github login" opens the card; a message that looks like a password is held back with
  a warning and the secure card instead (`lib/secret-text.js`). On the plain web the card explains logins are saved
  only in the Android app, with the download link.
- **Approval before submit, pay, delete or send**: risky steps wait for the user's yes on the phone (a notification
  when the app is in the background).
- **Background runs**: a running task keeps going while Colon AI is in the background (`SagaService`, an ongoing
  notification), with a notification when it is done or needs you.
- **Scheduled browsing** ("check yolotask every morning and tell me what's new"): the server keeps the schedule and
  asks the phone to run it in that chat's browser; results come back to the chat with what changed. **Routines**:
  "save this as a routine called daily update", then "daily update" replays it. Settings › Saga lists, pauses,
  runs and deletes them.
- **Mid-task steering**: a message sent while Saga works goes to the running task (`/browser/agent/:id/guide`) and
  is taken into account at its next step.
- **Multiple tabs** (at most 6), **extract to a table** in the chat with a **CSV download** (`lib/table-csv.js`,
  spreadsheet-formula injection guarded), **speed mode** (fewer model calls for slow networks; Settings › Saga).
- **Support models after Gemma 4**, for chat replies and Saga's browser decisions: first three Google AI Studio models
  on the same `GEMINI_API_KEY` (`gemini-flash-lite-latest`, Google's alias for the newest Flash-Lite;
  `gemini-3.5-flash-lite`; `gemini-2.5-flash`), then Groq `openai/gpt-oss-120b`, then OpenRouter's free Gemma. Each
  Google model has its own free quota and rests on its own, so a 429 on Gemma does not skip them; they read images.
  **`gemini-2.5-flash` is deprecated** (Google: API access for existing users only; from 1 Dec 2026 its requests are
  routed to `gemini-3.5-flash-lite`): a "not found" / "not available" answer skips it for 24 hours without failing
  the reply. A short `Retry-After` is waited out once; prompts are trimmed to each provider's limits; Admin › Routing
  shows them.
- Server hints for `signIn` answers `not_trusted` (don't retry; let the user sign in) and `wrong_site` (open the
  site's own sign-in page first).
### Fixed
- **The browser card drew over the sidebar drawer, menus and sheets**: the chat now watches every overlay (drawer,
  menus, sheets, dialogs, pickers, scrims; `lib/overlay-watch.js`) and tells the app `browser('suspend', {on})`; the
  card hides until the last overlay closes.
- **The card shook while scrolling or touching**: anchor reports are coalesced to one per frame and snapped to
  whole device pixels (`lib/native-anchor.js`); the app places the card once per vsync with a dead band and a
  settle pass (`InlineSteady`), and a gesture that starts on the page no longer fights the thread's scrolling.
### Config (cPanel › Node.js app › Environment variables)
New, all optional with working defaults: `AI_SUPPORT_MODELS`, `GEMINI_SUPPORT_MODELS`, `GEMINI_SUPPORT_VISION`,
`GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS`, `GROQ_SUPPORT_MODEL`, `OPENROUTER_SUPPORT_MODEL`,
`GROQ_SUPPORT_MAX_INPUT_TOKENS`, `OPENROUTER_SUPPORT_MAX_INPUT_TOKENS`, `GROQ_SUPPORT_REASONING`,
`AI_RETRY_WAIT_MS`, `SAGA_SCHEDULES_MAX`. Set **`GROQ_API_KEY`** and **`OPENROUTER_API_KEY`** for the support models
(without them only Gemma 4 answers). Run migration 0011 (deploy runs pending migrations; check `/health`).

## [0.10.6] — 2026-11-14 · Clean new chats, honest "done", Gemma 4 only, the assistant is Colon
Owner's report on 0.10.5 (Infinix SMART 20, Colon AI app). Every version number moves to 0.10.6 (apps,
`Colon.version`, `version.json` versionCode 1006 for both APKs). No migration. New config key `AI_MODEL_SET`
(default `gemma`: nothing to set on the server for the new behaviour).
### Root causes
- **Old browser card on a new chat**: on a chat switch the page asked the app for the chat's finished cards
  *before* telling it about the switch, so the app answered with the previous chat's cards (the yolotask picture,
  "Done", expand); and the live card was shown whenever the app's panel was open, whichever chat it belonged to.
- **False "I have reached the GitHub login page"**: Saga's `finish` was taken on its word. Its first decision was a
  finish (no navigation); the browser still showed yolotask, the card kept that page's picture, and with no written
  answer the reply was "I finished browsing but have nothing to report".
- **Stuck "Reconnecting to Saga…"**: the pill showed whenever the phone's link was not `BRIDGE_READY`. A socket that
  came back but whose bridge greeting was lost stayed `CONNECTED` while Saga's commands kept arriving, so the pill
  never cleared (the task itself carried on: the card showed GitHub's sign-in page).
- **"Always catching up"**: every reply raced two models at once (`AI_HEDGE=2`: Gemma 4 26B against MiniMax or
  another host) and specialist routing could put another model first; the browser agent's decisions went through
  the same chain. No judge/verifier model runs per reply; Research mode's optional query rewrite (one short call,
  4 s budget) goes through the same chain, so it is Gemma 4 too.
### Fixed / changed
- **A new or empty chat shows no browser card** (`lib/native-panel.js` `liveHere`, `browser-panel.js`,
  `browser-card.js`): the live card shows only when the app's state names this chat, and on an empty chat only
  while a task of its own runs or the user opened its browser with the Browser button. Cards are asked for after
  the app has switched (none for a new chat), a chat with no messages draws none, and `liveAnchor` is cleared when
  the chat changes.
- **Saga's finish is checked against the page** (`modules/saga/goal.js`, `loop.js`): a goal that names a site
  ("go to the GitHub login page") needs the current URL's host to match; a sign-in page goal needs a sign-in URL or
  title; a finish before any action, with no page to confirm it, is refused. A refusal goes back to Saga as an
  observation (logged as `goal_not_met`); after 2 refusals the finish stands, so no task is trapped. Saga's prompt
  says so.
- **The reply says what Saga did**: with no written answer it uses the result line, else Saga's words, else its
  last step ("Opened GitHub's sign-in page."), never "nothing to report".
- **A new task never shows the previous task's picture as its own** (Android `ChatRunKeeper.clearLive` /
  `livePicture`): the step picture is dropped when a task starts; a reloading page shows only this task's picture,
  and an ended card falls back only to it (blank rather than an older page).
- **The "Reconnecting to Saga…" pill clears** (Android): an open socket counts as linked (`ChatRun.linkUp`); any
  command, control request, hand-off or notice from the server marks the bridge ready; a finished step clears it;
  and it never stays longer than 90 s (the server's reconnect grace). It only ever shows on a running task, so a
  task end clears it too. "Retry" after an ended task is a continuation (unchanged) and now ends with a real reply.
- **Gemma 4 only** (`modules/ai/model-set.js`, `generate.js`; `AI_MODEL_SET=gemma|all`, default `gemma`): chat
  replies, CBT, Research's query rewrite and Saga's browser decisions use Gemma 4 26B on Google AI Studio, with Gemma
  4 31B only when 26B fails or times out, one model at a time (no hedging, no specialist reordering, no MiniMax,
  Qwen, DeepSeek, GLM or NVIDIA). Without a Google key, a non-NVIDIA Gemma 4 host is used; a config with no Gemma 4
  model at all keeps its own chain. `AI_MODEL_SET=all` restores the full table, hedging and specialists. Admin ›
  Routing shows the Gemma chain in force (`model_set`, `gemma_chain`).
- **The assistant is Colon; Saga is the model**: replies are signed "Colon" ("Colon is thinking…"), the model
  selector shows "Saga", the disclaimer reads "Colon can make mistakes…", errors and help say Colon, and the system
  prompt introduces Colon (asked about its model, it says Saga). Browse wording that is the model acting ("How Saga
  browsed", "Saga took too long to decide") stays. Model id `colon-saga` and stored keys are unchanged.
### Tests
- `model-set.test.js` (5), `saga-goal.test.js` (5), specialist-routing (Gemma-only case; the existing cases run with
  `AI_MODEL_SET=all`, as do the router, hedge, specialists, stream and admin-config suites), `native-panel.test.js`
  (`liveHere`), `ChatRunTest.kt` (`linkUp`); wording updates in chat, safety-guards and safety-flow tests.

## [0.10.5] — 2026-11-14 · "Show the browser" brings the live card to you
Chat page fix; the APK is rebuilt only to keep versions in step (`version.json` versionCode 1005).
### Fixed
- **"Reshow / open the browser" showed nothing.** The chat replied "Here's this chat's browser…" but the live card
  stayed under the old task's message far up the thread (and, with the panel already open, never scrolled into
  view). After a task ended, reopening now places the live card under that reply and scrolls it into view
  (`S.browser.liveAnchor`, `revealNext`); a running task keeps its own message. The old task keeps its picture card.

## [0.10.4] — 2026-11-14 · Saga's in-chat browser is robust and watchable
Owner's report on 0.10.3 (Android, Developer chat): after "Login" Saga asked them to sign in, but the card was blank
with "Saga stopped" and Retry; after logging in Saga "was unable to catch up"; "Reshow the browser" went to the
model, which said it couldn't; and Saga's pointer and taps could not be seen. ADR 0006 addendum. Every version
number moves to 0.10.4 (apps, `Colon.version`, `version.json` versionCode 1004 for both APKs). No migration.
### Root causes
- The server's waiting task was left in `handoff` with no end (admin replay: 2 rows, `request_user_control`
  `sign_in`): the worker holding it went away while it waited, and nothing picked it up again.
- A dropped socket ended a waiting task at once (`disconnected`), and a new socket refused the user's Give back
  (`needs_consent`: consent lived only on the old socket).
- An app closed or rebuilt mid-task lost its control state: the card turned into "Saga stopped (when the app
  closed)" and Give back was refused on the phone (ended as stopped); the live page had no picture, so the card
  showed white while it reloaded.
- "Reshow the browser" wasn't a browser intent, and the model's prompt didn't know about the in-chat browser.
- Saga's pointer sat under the card's controls, was small at card scale and faded 1.2 s after every tap.
### Fixed / changed
- **Tasks survive the socket and the worker** (`modules/saga/link.js`, `resume.js`): a dropped socket waits up to
  `SAGA_RECONNECT_GRACE_MS` (new, default 90000) for the same phone; the new socket takes over on this worker, or
  another worker adopts the task; workers stamp their tasks and adopt ones whose worker went quiet. Reads in flight
  are re-sent; actions are reported to Saga as "may or may not have happened". Every end now tells the phone.
- **Give back always works**: hello `resumable` keeps consent on a new socket; the app re-sends its latest control
  report after reconnecting; after the app was closed a known task waits for the user (Give back carries on) and
  the phone puts back a lost control state instead of ending the card as stopped. The chat page follows a live task
  again after a reload.
- **Continue**: an ended card whose page is still there shows Continue (reopens the live browser on its page and
  starts `POST /browser/agent { continue_of }`, which folds the earlier steps into Saga's prompt and stops the
  earlier task if it was still live). In the chat, "reshow / show / reopen / bring back the browser", "where is the
  browser?" open it, and "continue", "carry on", "I've logged in, continue" after a task ended continue it; none of
  these go to the model. The system prompt (all modes) says Saga can open the in-chat browser.
- **Watchable**: the pointer sits above the card's controls, 1.5× with a halo, stays on the page while Saga works,
  outlines the element it clicks or types into, and Saga types text out piece by piece (act.js `type`, then the
  exact fill). The pill says "Reconnecting to Saga…" while the link is down.
- **Never blank**: the card keeps the page's picture after every finished step (`ChatRunKeeper.saveLive`), shows it
  while the page (re)loads, uses it for the finished card when the live capture fails, and never keeps a picture of
  a page that hadn't painted.
- Admin › Browser shows waiting tasks and continuation rows by name.
### Tests
- `saga-reconnect-runner.test.js` (9: wait survives a drop, grace runs out, read re-sent / action not repeated,
  moved, adoption with history, orphans expire, `continue_of`, summary), `saga-phone-act.test.js` (`type`),
  `browser-intent.test.js` (reshow / continue), `ChatRunTest.kt` (restore, Continue, reconnecting, control state
  restore, hello `resumable`, pointer box, typing pieces, blank pictures).

## [0.10.3] — 2026-11-14 · Saga's browser is an AI-only card in the chat, with Take control
The owner's redesign of the in-chat browser (ADR 0006, `docs/decisions/0006-inline-ai-browser.md`): instead of a
second browser squeezed into the chat that the user could also drive, each Saga task is a "Manus-style" card in the
thread, always Saga's, and the user steps in only with Take control. Every version number moves to 0.10.3 (apps,
`Colon.version`, `version.json` versionCode 1003 for both APKs). No migration (the new task statuses fit the
existing `saga_tasks.status` column and the result line is read from the task's `finish` step).
### Changed
- **One card per Saga task, in the thread.** The card sits under the message that started the task and scrolls with
  the thread: a landscape (16:10) live desktop page scaled down, capped to fit above the composer, with a status pill
  (Saga's step with a spinner; "Saga needs you: …" with Take control; a check and the result line; an error with
  Retry; Stop while it runs) and an expand button. Only the newest task holds the live WebView; finished cards keep
  a small picture of the page (at most 6 pictures, 600 KB and 20 cards per chat) and a tap reloads the live page.
  Cards no longer jump: the chat page re-places them only when the cards themselves change, not on every page
  load or step (`components/browser-card.js`).
- **Always the desktop site.** A desktop user agent, wide viewport and a document-start script that keeps the page
  at `width=1280` (`DesktopView`; less on phones narrower than 320 dp).
- **Always AI-only.** The page takes the user's touches, scrolls and keys only after Take control. The "AI only /
  AI + me" choice is gone from Settings and from the browser's status dialog; "let me help" in the chat explains
  Take control instead of switching modes. Colon Browser keeps its own modes.
- **Take control opens full screen over the chat**, the same WebView (no reload) from the top of the screen to the
  top of the composer, which stays pinned and follows the keyboard. A slim bar has back, title and host, reload,
  Give back to Saga and a more menu (Stop, Open in Colon Browser, share, downloads, clear data). Whatever the user
  sends from the composer is their hand-back: it goes to Saga as a note ("I've logged in, continue") with the page's
  host and path and anything secret-looking hidden (`HandoffNote`; the server hides it again).
- **A task started from the chat is the user's consent** for that chat: no "Let Saga browse?" dialog. A task the
  server starts any other way still asks.
- **The server waits instead of ending.** Take control and Pause no longer end a task (`interrupted`): the loop waits
  (task status `user_control` / `paused`) for Give back / Resume and folds the user's note into the next step. Time
  spent waiting for the user doesn't count against `SAGA_TASK_TIMEOUT_MS`. A wait that runs out stops the task
  cleanly (`handoff_timeout` / `user_timeout`; the phone gets `control manual` and a `stopped` notice).
- **The web shows the same card shape** with the task's status or result and "Open in the Colon AI app for the live
  browser" (no snapshot: the server keeps no page pictures). `GET /browser/agent?conversation_id=` lists one chat's
  tasks with `conversation_id` and `result`.
### Added
- **`requestUserControl { reason, instructions }`**, a new Saga tool to hand the browser to the user for a sign-in,
  code, captcha, payment or consent (a `handoff` frame with `timeout_ms`; "Saga needs you" with Take control).
  `finish` takes a short `result` for the status pill. Secret fields still hand over by themselves.
- **`SAGA_USER_CONTROL_TIMEOUT_MS`** (default `900000`, 15 minutes): how long Saga waits for the user to give the
  browser back after Take control or Pause before it stops the task. Saga's own requests keep
  `SAGA_HANDOFF_TIMEOUT_MS` (10 minutes).
- Stop in the card's more menu while Saga runs; a notification (channel `saga`) when Saga needs the user and the app
  is in the background.
- If the app is killed mid-task the card shows "Saga stopped when the app closed" with Retry; a dropped connection
  ends the server's task (`disconnected`) and the card offers Retry, which runs the same goal under the same message.
- Docs: ADR 0006, `docs/android-bridge.md` (`browser('task' | 'cards' | 'control')`, `run` and `focus` in the state,
  `browserRetry`, `note` on `control`, the new `handoff` kinds and `timeout_ms`, `notice` kinds `error` · `stopped`).
- Tests: `services/api/tests/unit/saga-user-control.test.js`, `saga-user-control-runner.test.js`,
  `packages/ui/test/saga-card.test.js`, `ChatRunTest.kt`.

## [0.10.2] — 2026-11-14 · Saga really clicks, types and scrolls; AI only locks the page; AI + me shows Saga's words
The owner's report from the phone (Colon AI, in-chat browser): the browser panel covered the message box while
scrolling, Saga's touch and pointer did not work, "AI only" still let the user's fingers in, and "AI + me" showed
nothing of what Saga was doing or asking. Every version number moves to 0.10.2 (apps, `Colon.version`,
`version.json` versionCode 1002 for both APKs). No migration.
### Fixed
- **The browser never slides over the composer.** Two causes. (1) When the chat shrank (the keyboard opening, the
  composer growing to two lines), the app re-laid its views a frame or more before the chat page reported the new
  composer position, and the clip then ran to the bottom of the shrunken layer, right over the message box
  (`InlineGeometryTest` even described it: "the clip stops at the layer's bottom"). The anchor now carries
  `pageHeight`, and the app keeps the gap the page saw under the band from the WebView's bottom as it is now
  (`InlineGeometry.place(…, shellHeight)`). (2) The anchor's numbers were relative to the layout viewport, not the
  visual viewport the app's WebView shows; with the visual viewport moved (the frame follows it with `--vvt`) the
  panel and its clip landed lower than the composer. Numbers are now measured from the visual viewport's corner,
  with its scale in `dpr` (`lib/native-anchor.js` `screenOf`). The composer is looked up on every measure (a
  re-drawn composer still counts) and its "Latest" button ends the band too.
- **A shorter panel.** The in-thread body box is 50vh (was 60vh, about a sixth shorter), never taller than the space
  between the header and the composer, at least 240 px (was 320 px), so the whole page fits above the message box
  with the keyboard open or not.
- **Saga types for real.** `fill` set the value with the native setter and fired bare `input` / `change` events,
  then answered `ok` without checking; rich editors (`contenteditable`) and sites that listen for `beforeinput` /
  `inputType` ignored it. New `assets/saga/act.js`: focus, select what is there, `execCommand('insertText')` (the
  browser's own editing path), falling back to the native setter plus an `InputEvent`; `<select>` by option text;
  Enter submits the form only when the page did not handle Enter itself. `ack.result.typed` says whether the text
  is really there and the model is told plainly when it is not.
- **Saga scrolls for real.** `scroll` was `window.scrollBy`, which does nothing on the many sites whose page is one
  screen with a scrolling container, and always answered `ok`. Now a real finger swipe with the pointer riding
  along, checked before and after; when nothing moved (or for top / bottom) the scrollable element under the middle
  of the view, or the page, is scrolled by script. `ack.result.moved` tells the model when it is already at the end.
- **A tap that did nothing is tried once more.** When a real tap changes nothing at all, the script click follows
  once (`method: "tap+script"`), never for a step the user had to approve (payments, purchases, messages, forms).
- **Long page reads are no longer lost.** An ack over the server's 64 KB frame limit (long text, many long links)
  was refused by the server and the step timed out, so Saga had no element ids to click; the phone now trims it
  (`BridgeProtocol.fitAck`).
- **"AI only" locks the page.** While Saga has the browser in AI only (paused too), the page ignores the user: the
  shield with Take control covers it and the tab's WebView (`TabWebView`) drops the user's touches, wheel and keys
  and gives the keyboard nothing to type into, so a field Saga tapped can't be typed in by the user either. Saga's
  own taps and swipes go through. "AI + me" is unchanged: the user interacts normally.
### Added
- **Saga's words on the page in "AI + me".** Each command carries Saga's one-line `say` ("Clicking Sign in"); the
  phone shows it, its requests to the user ("Your turn: enter the code…") and the server's new `notice` frame
  ("Done. Saga's answer is in the chat.") as a pill at the top of the browser that fades by itself and never takes
  a touch (`SagaNotice`, `modules/browser/frames.js`). The chat brings the browser card into view when Saga takes
  the browser, so its pointer can be seen.
- Docs: `docs/android-bridge.md` (anchor `pageHeight` and visual viewport, `say`, `notice`, fill / scroll results,
  the AI only lock).
- Tests: `tests/unit/saga-phone-act.test.js`, `tests/unit/saga-notice.test.js`, the visual viewport and composer
  cases in `packages/ui/test/native-anchor.test.js`, `SagaTouchTest.kt`, the stale-report case in
  `InlineGeometryTest.kt`.

## [0.10.1] — 2026-11-13 · Composer pinned with the in-chat browser open; Saga clicks for real
A fix from the owner's phone (Infinix SMART 20, app 0.10.0, inline browser card open): the message box ("Ask Colon
anything…") and its "Synced" line seemed to scroll away with the thread instead of staying at the bottom of the
screen. Every version number moves to 0.10.1 (apps, `Colon.version`, `version.json` versionCode 1001 for both APKs).
### Fixed
- **The app's browser WebView no longer covers the composer.** The thread (`.cw-scroll`) runs under the floating
  composer (padded by `--composer-h`), but `lib/native-anchor.js` reported the scroller's bottom as
  `viewportBottom`, so the app clipped its WebView only at the screen's edge and it slid over the message box and the
  "Synced" line as the card moved through the bottom of the thread. The band now ends at the composer's top
  (`viewOf(scroller, win, cover)`, `createAnchor({ cover })`, the composer is also watched for size changes), as
  `docs/android-bridge.md` always promised: the panel stays between the header and the composer.
- **Only the thread scrolls.** The card was brought into view with `scrollIntoView()`, which also scrolls the fixed
  frame (`.cw`, overflow hidden but scrollable by script), the page and the phone's visual viewport. New
  `lib/thread-scroll.js`: `reveal()` scrolls `#cw-scroll` alone into the band between the header and the composer
  (opening the card, the web's embedded card, and the keyboard opening for the panel's page); `pinFrame()` puts the
  frame and the window back at 0 if anything else moves them. Older WebViews without `dvh` keep a full-height frame.
- Tests: `packages/ui/test/thread-scroll.test.js` and the composer band in `native-anchor.test.js`.
- **Saga's clicks are real taps, and you can see them** (owner's report: no pointer in the in-chat browser, and Saga
  didn't seem able to click). Clicks did run, but as `el.click()`: an untrusted synthetic click that sites listening
  for pointer, mouse or touch events (or checking `isTrusted`) ignore, with nothing on screen, answered `ok` with
  the URL from before the click, so Saga was told "done" even when nothing happened. Now the phone taps the element's
  centre with real `MotionEvent`s (`SagaClicks.kt`, `SagaTap.kt`; tools.js `point` gives the spot as fractions of
  the visible viewport), falling back to a pointer / mouse / focus / click sequence when the element is off screen
  or covered. The secret-field refusal runs right before every tap path, including a secret field laid over the
  element.
- **Saga's pointer.** A Colon-blue arrow with the brand's two dots glides to the element before each click, fill and
  scroll, ripples where it taps, then fades (`SagaPointer.kt`). It never takes a touch, so "AI + me" works as before,
  and it hides when Saga loses control or hands a secret field to you.
- **Saga hears what a click did.** `ack.result.changed` (`navigated`, `url_changed`, `page_changed`,
  `element_changed`, `focused`, `none`, `unknown`) from tools.js `outcome`; the model is told plainly when nothing
  changed so it retries another element instead of assuming success, and keeps its element ids when the page did not
  change (`modules/saga/prompt.js`, `loop.js`). `docs/android-bridge.md`, "Real clicks and Saga's pointer".
- Tests: `tests/security/saga-phone-click.test.js`, `tests/unit/saga-click.test.js`, `SagaTapTest.kt`.

## [0.10.0] — 2026-11-13 · One browser per chat
Phase 10, the owner's design: every conversation has its own in-chat browser, driven from the chat, instead of the
chat sharing Colon Browser's tabs. Every version number moves to 0.10.0 (apps, `Colon.version`, `version.json` for
both APKs, versionCode 1000). Migration `0010_chat_browser_sessions.sql` runs on API start.
### Added
- **One browser per chat (API, migration 0010).** Browser sessions are kept per device **and** conversation
  (`browser_sessions.conversation_id`; `''` stays the device-wide session of Colon Browser and older apps).
  `GET/PUT/DELETE /browser/session` take `conversation_id`; `GET /browser/sessions` lists it. Deleting a chat (or
  all chats) deletes its browser sessions and Saga tasks.
- **Modes per chat: AI only and AI + me.** "AI only" (`ai`): Saga drives, you watch. "AI + me" (`shared`): you both
  act and Saga sees what you changed (the latest `page_state`, memory only). Default in Settings (`browserMode`),
  per chat with `PATCH /conversations/:id { browser_mode }` (`chat_conversations.browser_mode`) and the mode chip on
  the card; `POST /browser/agent` takes `mode` (`saga_tasks.mode`). Control rules in `modules/browser/control.js`.
- **Saga never fills secret forms.** Passwords, one-time codes, card numbers, PINs, and sign-in and payment pages go
  to the user: the server (`modules/saga/secrets.js`) and the phone (`SecretFields.kt`, `tools.js`) both check, the
  page is handed over ("Your turn" on the card) and Saga waits up to `SAGA_HANDOFF_TIMEOUT_MS` (default 600000) for
  Return to AI. Snapshots sent to the model and the logs are redacted.
- **Chat-driven browsing.** Tell Saga in the chat to open the browser and what to do: "open the browser", "open
  google.com", "scroll down" run on this chat's own browser (`lib/browser-intent.js`); anything else becomes a Saga
  task in this chat. On the web the chat's reader session is per chat too.
- **Android: one in-chat browser per conversation** (WebView profiles: own cookies, storage, tabs and history; the
  least recently used beyond `-Pcolon.chatProfiles`, default 20, are deleted; one shared profile, cleared on chat
  change, on WebViews without profiles). Consent lasts 10 minutes for the same chat's next instructions; Stop,
  declining or another chat ends it. Deleting a chat forgets its browser.
- **Bridge:** `browser` actions `chat`, `forget`, `mode`, `control` (feature `browserChats`); WebSocket frames
  `chat` (app → server) and `handoff` (server → app); `conversation_id` on `hello`, `session_sync`, `page_state`,
  `control` and `command`; control reasons `handoff` and `mode`; ack error `secret_field`; server error `other_chat`
  (a command for a chat the panel isn't showing). See `docs/android-bridge.md`.
### Fixed
- **Handoff ordering.** The phone sends the `secret_field` ack before its `handoff` control report, and a handoff
  report no longer cancels pending commands, so the server waits for the user instead of reading a takeover.
- **Handoff wait re-arm.** Saga re-arms its wait for the phone before checking for Stop, so a Return to AI tapped in
  between is never missed.
### Tests
- `services/api/tests/unit/browser-chat-sessions.test.js`, `saga-handoff.test.js`,
  `tests/security/saga-secrets.test.js`, `packages/ui/test/browser-intent.test.js`, `browser-modes.test.js`,
  `scripts/deploy/android-version.test.js` (two-digit minor); Kotlin `ChatSessionsTest`.

## [0.9.2] — 2026-11-13 · The browser panel stays inside the conversation
Fix for 0.9.1 on real phones: the in-chat browser panel could still open pinned above the chat (embedded, with its
own header) instead of inside the thread. Every version number moves to 0.9.2 (apps, `Colon.version`,
`version.json` for both APKs, versionCode 902).
### Fixed
- **Android: "can the page draw the card?" no longer starts as "no".** 0.9.1 started it false and only flipped it
  when the chat page made a `browser(...)` call with `inline: true`, so a panel the app opened by itself first
  (Saga's auto-open when it asks to browse, a link the shell routed, `openTab`) showed embedded; the 4 s grace
  after a page load could also run out on a slow phone and leave it embedded. It now starts unknown (inline,
  hidden until the card reports), the grace (6 s) is armed on every open and every chat page load, and an
  `anchor` report counts as the page saying it draws the card.
- **Android: phones open every panel in the conversation** (Browser button, AI Browse, Saga, links, reopen after
  collapse or full screen) — `PanelLayout.openMode`. Collapsing from full screen or split no longer saves the
  embedded fallback as the preferred layout (in 0.9.1 that pinned every later open above the chat). Embedded and
  split from the panel menu still work while the panel is open; wide screens keep their saved layout.
- **Chat:** the panel state now carries `inlineReady`; whenever it is false the page tells the app it draws the
  card (with a 0.9.1 app, once per page when the panel is embedded). The page follows the panel as soon as the
  bridge is ready instead of after settings and models load, re-syncs on resume, sends anchors with
  `inline: true`, and draws the card even without the header Browser button (`lib/native-panel.js`).
### Tests
- `packages/ui/test/native-panel.test.js` (the handshake, including a model of the app: Saga/link opens before the
  page spoke, a slow reload past the grace, reopen after full screen); Kotlin `InlineOpenTest`.

## [0.9.1] — 2026-11-13 · The browser panel inside the conversation
On phones, Colon AI's browser panel now shows inside the chat thread, where the web's "Colon Browser" card sits,
instead of being pinned above the chat header. Every version number moves to 0.9.1 (apps, `Colon.version`,
`version.json` for both APKs, versionCode 901).
### Added
- **Layout `inline`** for the in-chat browser panel (Android, `PanelLayout.Mode.INLINE`), the default on phones
  (wide screens still open split). The chat draws the card (status dot, "Colon Browser", the address, collapse,
  full screen, close) and an empty body box (60vh, at least 320 px); the app lays the panel's WebView over that
  box, clipped to the visible thread so it never covers the chat header or the composer, and hides it when the card
  is scrolled away or collapsed. Scrolling only translates the panel (no relayout); the same WebView is kept when
  switching to embedded, split or full screen and back, so nothing reloads. "In the conversation" in the panel
  menu (full screen) switches back. Saga opening the panel when it asks to browse opens it inline too.
- **Bridge:** `browser('anchor', { visible, x, y, width, height, viewportTop, viewportBottom, dpr })` (the card's
  body box in CSS px; sent on open, scroll, resize and keyboard, at most once a frame and only when it changed),
  `inline: true` on any `browser(...)` call (the page draws the card), `layout: 'inline'` in the panel state and
  the `layout` action, feature `browserInline` (docs/android-bridge.md).
- **Chat:** `lib/native-anchor.js` (measures and reports the box; keeps the card on screen when the keyboard opens
  for the panel's page) and the card in `.cw-native-host`; tests in `packages/ui/test/native-anchor.test.js`.
  Kotlin: `InlineGeometry` (CSS px -> device px and the clip, `InlineGeometryTest`), `InlineLayer`.
### Changed
- The panel's saved layout moved to a new preference key (`layout`), so phones start in the conversation once
  after the update; a layout picked from then on is remembered.
### Compatibility
- An older chat page in the new app never sends `inline: true`, so the panel stays embedded above the chat as in
  0.9.0 (`state.layout` reports what is shown). The new chat page in an older app (no `browserInline`) keeps the
  0.9.0 behaviour. When the chat page reloads, an inline panel waits hidden up to 4 s for the new page.

## [0.9.0] — 2026-11-13 · Phase 9: Saga browser automation
Saga browses for the user on their phone: it drives the Colon AI browser panel (a real WebView with the user's own
cookies) through the WebSocket bridge, explains every step, cites the pages it read, and waits for the user's tap
before anything risky. Every version number moves to 0.9.0 (apps, `Colon.version`, `version.json` for both APKs).
### Added
- **Saga module** (`services/api/src/modules/saga`, ADR 0005): a decision -> action -> observation loop over the
  existing model router (one JSON action per step, the usual model deviations repaired), the controlled tool set
  `openUrl, getPageContent, getLinks, click, fill, scroll, screenshot, back, forward, refresh, tabs, finish` with
  arguments rebuilt from per-tool allow-lists, blocked hosts refused, element ids only from the latest page read.
  Limits: `SAGA_MAX_STEPS`, `SAGA_TASK_TIMEOUT_MS`, `SAGA_MODEL_TIMEOUT_MS`, `SAGA_STEP_TIMEOUT_MS`,
  `SAGA_APPROVAL_TIMEOUT_MS`; Take control, Pause, Stop or a dropped socket end a task at once.
- **Untrusted pages:** page text, titles, element labels, links and tab titles are neutralised by the safety
  layer's injection guard and fenced with random-id markers; flags are recorded as safety events (route `saga`).
- **Approvals tapped on the phone** for payments, purchases, form submissions, sending messages and personal data:
  the server's policy (`policy.js`) and the phone's check of the real element (`assets/saga/tools.js`) both count,
  the stronger wins; the model can't pre-approve; an `ok` answer without the user's approval stops the task
  (`approval_missing`); a decline is respected. Shared mode asks before every changing step.
- **Action log and replay:** migration `0009_saga_tasks.sql` (`saga_tasks`, `saga_actions`; typed personal data
  hidden, page text never stored), audit entries `saga.task_created` / `saga.task_finished` /
  `admin.saga_replay_viewed`. REST: `POST /browser/agent`, `GET /browser/agent`, `GET /browser/agent/:id?after=`,
  `POST /browser/agent/:id/stop`; admin: `GET /admin/saga/tasks`, `GET /admin/saga/tasks/:id`. Admin › Browser
  lists tasks with a step-by-step replay (it was a placeholder).
- **Bridge:** `command(name, args, tab, { timeoutMs })`, `waitControl()`, `hasControl()`, the phone's
  `capabilities` kept from `hello` (`supports()`); tasks are queued in MySQL and claimed by the worker that holds
  the phone's socket (`ws/index.js` starts the sweep); unclaimed tasks fail with `no_phone` after a minute.
- **Android (both apps):** `get_page_content`, `get_links`, `click`, `fill`, `scroll`, `screenshot` (`SagaTools`,
  `BrowserSaga`), advertised in `hello.capabilities`; the "Approve Saga's next step?" dialog; Allow on "Let Saga
  browse?" always answers `consent`. Colon AI opens its browser panel by itself when Saga asks to browse (Phase 10).
- **Chat:** AI Browse in the Android app (`Colon.native.hasPanel()`) runs on the native panel through Saga
  (`apps/chat/src/actions/saga-native.js`): the panel opens at once, each step's explanation is shown, and the
  answer with "How Saga browsed" and its cited pages is added to the chat. The web reader's AI Browse stays for the
  web, guests, older apps and servers without Saga.
- Config: the seven `SAGA_*` keys (`config/api.env.example`, `config/README.md`).
- Tests (30): `tests/unit/saga-loop.test.js`, `tests/unit/saga-runner.test.js`, `tests/security/
  saga-approval.test.js`, `tests/security/saga-injection.test.js`, `tests/security/saga-phone-tools.test.js`;
  Kotlin `SagaPhase9Test.kt` (runs in the Android CI).
### Not yet
- The Phase 9 release standard on real phones (multi-step tasks on real sites, injection pages, approvals); the
  Kotlin changes were written without a local Android build.
- Screenshots are not given to the model; no push to wake a phone whose app is closed; `page_state` not stored.

## [0.8.1] — 2026-11-13 · Phase 8 server pieces: reader and session manager
The two server pieces Phase 8 left open, built to `docs/phase8-backend-contract.md`. API only: the web clients
already call these endpoints, so no client change was needed. (Version numbers in `package.json` and the apps stay
at 0.8.0 until the release is cut.)
### Added
- **Server reader `GET /browser/fetch`** (`services/api/src/modules/browser`): reads one public page on the server
  for web light mode. SSRF guard: http/https on ports 80/443 only, DNS resolved on the server and every address
  checked (private, loopback, link-local, CGNAT, multicast, IPv6 ULA/link-local, cloud metadata), the socket pinned
  to the checked address, every redirect checked again (at most 5). 10 s, 2 MB, HTML and plain text only, no
  cookies or auth headers, `ColonReader/1.0` user agent. Regex sanitiser with the client's tag allow-list
  (scripts, styles, frames, forms, media, nav/aside and every `on*` attribute removed; links and images made
  absolute; small `data:image` only), plus title, byline, lang and text (≤ 200 000 characters). `robots.txt`
  honoured; host block list in the safety layer (`modules/safety/hosts.js`: adult and malware hosts plus
  `BROWSER_READER_BLOCKLIST`). Contract error codes (`bad_url`, `blocked_private`, `too_large`, `not_html`,
  `needs_login`, `rate_limited` with `retry_after`, `upstream_error` with `upstream_status`, `timeout`,
  `not_enabled`). 30 a minute and 500 a day per user, 60 a minute per IP for guests. 10-minute cache, shared
  between users only when the site sent no cookie and allows shared caching. Logs only user id, host, status,
  bytes and time.
- **Browser session manager**: migration `0008_browser_sessions.sql` (`browser_devices`, `browser_sessions`,
  `browser_tabs`, `browser_history`); `GET`/`PUT`/`DELETE /browser/session` per user and device with optimistic
  `version` (`409 conflict` with the current session), `GET /browser/sessions`, and opt-in `/browser/history`.
  Private tabs are never stored, URLs over 2048 characters are dropped, at most 30 tabs, idle sessions deleted
  after 30 days.
- **WebSocket bridge** (`ws/index.js`, `modules/browser/bridge.js`): sockets are tied to the signed-in user (the
  `colon_sid` cookie); `hello` with `app` registers the device and is answered with `bridge: 1, session: 1`;
  `session_sync` (one write per 2 s, latest wins; 64 KB frames; 10 tabs on low-RAM phones) and `session_request`
  (answered by `ack`); control owner rules (AI/Shared only after consent; Take control, Pause, Stop and Declined win
  at once and cancel pending Saga commands with `manual_control`), every change in the audit log.
- Config: `BROWSER_READER`, `BROWSER_READER_GUESTS`, `BROWSER_READER_BLOCKLIST`. The router gains `PUT` (CORS
  allows it). API errors can carry contract fields beside `error` and `message`.
- Tests: `tests/security/browser-reader.test.js`, `tests/unit/browser-html.test.js`,
  `tests/unit/browser-session.test.js`, `tests/unit/browser-bridge.test.js` (29 tests).
### Not yet
- Saga routing on the bridge (choosing a phone, sending commands, per-command rate limits) is Phase 9; the bridge
  already exposes `command`, `askControl` and `requestSession` for it.
- The "Sync my tabs with Colon" setting on the phones; `page_state` is not stored yet.

## [0.8.0] — 2026-11-13 · Colon Browser becomes its own app (Phase 8, client side)
Two Android apps from one project: **Colon AI** (chat, with a real browser panel beside it) and **Colon Browser**
(the full standalone browser). Web light mode gets its "open in the app" prompt and a server-reader adapter. The
server pieces of Phase 8 are not built yet; their contract is `docs/phase8-backend-contract.md`. Decision:
`docs/decisions/0004-two-android-apps.md`.
### Added
- **Two APKs, one Gradle project** (`apps/android`): product flavors `colonai` (`ng.nifelux.colonai`) and
  `colonbrowser` (`ng.nifelux.colonbrowser`), all code shared in `src/main`; per-flavor manifests, name, launcher
  icon (a cyan globe around the flame for Colon Browser), splash and update texts. versionCode 800.
- **Colon AI: in-chat browser panel** (`ChatBrowserPanel`, `PanelLayout`): pages from the chat open in a native
  WebView beside the chat instead of a separate screen. Embedded (collapsible), split (draggable divider; side by
  side on wide landscape screens) and full screen, switched without reloading. Address bar, back, forward,
  reload/stop, tabs (6), desktop site, share, downloads list, clear data, close; **Open in Colon Browser** (or its
  download page when not installed). Saga's AI / Manual / Shared control, consent and shield work in the panel.
  Bridge: `ColonNative.browser(action, …)` and the `browser` event (`docs/android-bridge.md`); the chat's Browser
  button and links drive it (`apps/chat/src/components/browser-panel.js`). On the web the reader panel stays.
- **Colon Browser app** (`BrowserActivity`, `BrowserMenu`): opens straight into the browser; **private tabs**
  (violet bar, no history or cache, never saved or seen by Saga, own cookies and storage in a throwaway WebView
  profile deleted when the last one closes; an honest warning on WebViews without profiles), **tabs and history
  that survive restarts** (`TabSnapshot`, saved as they change), **clear browsing data screen**
  (`ClearDataActivity`: history, cookies, cache, site storage, downloads list; Colon AI sign-in kept), **downloads
  list**, **desktop site** per tab, full-screen video (shared `Fullscreen`), web searches from other apps, "Ask
  Colon AI about this page" and "Open Colon AI" handoffs (`Handoff`).
- **Google and bank sign-in in a Chrome Custom Tab** (`SignInTabs`, `androidx.browser` 1.8.0):
  `accounts.google.com`, `accounts.youtube.com` and the internet-banking hosts of GTBank, Access, Zenith, UBA and
  First Bank (`UrlRules.CUSTOM_TAB_HOSTS`, extendable with `-Pcolon.customTabHosts=`); the tab reloads on return.
- **Per-app updates:** `version.json` gains a `browser` entry; each app reads only its own entry and accepts only
  an APK named for itself (`VersionManifest.forApp`). The top-level fields are unchanged, so v0.7.x keeps updating.
- **CI** (`.github/workflows/android.yml`): tests and lint for both flavors; builds, signs (same key) and
  publishes `colon-ai-<v>.apk`, `colon-ai.apk`, `colon-browser-<v>.apk`, `colon-browser.apk` and a `.sha256` for each.
- **Web light mode** (`packages/ui/js/browser/app-prompt.js`, `reader-proxy.js`): "Light mode … Open in the app for
  full browsing" above reader pages and the new tab page (Colon Browser's APK on Android, the release page
  elsewhere), a stronger prompt on sites that need the full browser; a server-reader adapter for
  `GET /browser/fetch` with graceful fallback, and a labelled **Preview** mock (`localStorage['colon.reader'] =
  'mock'`). Settings › App and Help list both apps; Colon Browser web Help explains light mode.
- Docs: `docs/phase8-backend-contract.md` (reader proxy, session manager REST and WebSocket messages, control
  owner rules), ADR 0004, `apps/android/README.md` rewritten for two apps.
- Tests: `BrowserPhase8Test.kt` (20 JVM tests: tab persistence, private-tab rules, Custom Tab hosts, desktop user
  agent, panel layouts, clear-data rules, downloads list, per-app update manifest, handoff), run for both flavors;
  `packages/ui/test/light-mode.test.js` (7); `scripts/deploy/android-version.test.js` checks both apps.
### Changed
- The browser engine is one module for both screens: `BrowserHost` (implemented by `BrowserActivity` and
  `ChatBrowserPanel`), `BrowserWeb`, `BrowserSaga`, `TabManager`. Saga can't read or drive private tabs
  (`private_tab` error; left out of `get_tabs` and `page_state`).
- Colon AI no longer contains a standalone browser screen; `openTab` and links open the in-chat panel.
### Not yet (stubbed)
- **Server-side reader** (`GET /browser/fetch`) and the **browser session manager** (tabs, URLs, history and control
  owner per user and device): not in `services/api`; clients fall back (contract in
  `docs/phase8-backend-contract.md`).
- Saga driving the native panel (Phase 9): the chat's AI Browse still runs in the web reader panel.
- Real-device testing of both apps (private tabs on old WebViews, Custom Tab round trips, split divider), push
  notifications, App Links, crash reporting.

## [0.7.1] — 2026-11-13 · Android app (Phase 7 begins)
Colon AI in a native Android shell, with Colon Browser built on Android System WebView. Built in the cloud by GitHub
Actions. Details: `apps/android/README.md`, `docs/android-bridge.md`.
### Added
- **Android app** (`apps/android`, `ng.nifelux.colonai`, Android 7.0+ / minSdk 24, targets API 36, about 2 MB
  shrunk with R8): loads `chat.apparatus.name.ng` with file picker, microphone, back button, offline screen with
  retry, downloads, edge-to-edge insets, system bars that follow the chat theme, and recovery when a low-memory
  phone kills the WebView renderer. Splash (SplashScreen API, backported) and adaptive/themed launcher icons.
  versionCode = major × 10000 + minor × 100 + patch (0.7.1 → 701).
- **Native Colon Browser** (`BrowserActivity`, `TabManager`, `BrowserWeb`): address bar (URL or search), back /
  forward / reload, home page with bookmarks, tabs (10 on low-RAM phones, 30 otherwise) with only 2–5 live WebViews
  (older background tabs are discarded and reload when opened), history and bookmarks on the phone only,
  DownloadManager downloads, full-screen video, uploads, per-site camera/microphone, "Clear browsing data" that
  keeps the Colon AI sign-in. Listed in Android's "Open with" for web links. Saga control indicator (AI / Manual /
  Shared) with Take control, Return to AI, Pause, Stop and a consent prompt.
- **`window.ColonNative` bridge** (`NativeBridge.kt`): origin-restricted to Colon's own pages (WebView
  `addWebMessageListener` / document-start script, with a checked fallback on old WebViews): `info`, `openTab`,
  `share`, `download`, `saveFile`, `haptic`, `requestPermission`, `checkUpdate`, `setTheme`, `setSession`,
  `takeShare`, `bridgeStatus`, plus `share` / `bridge` / `resume` events. User agent ends with `ColonAndroid/<ver>`.
- **Backend bridge client** (`BridgeClient`, `BridgeProtocol`, `Backoff`): WebSocket to `wss://api.apparatus.name.ng/ws`
  with reconnect backoff, heartbeats and network awareness; protocol in `docs/android-bridge.md`.
- **Share to Colon** (`ShareReceiverActivity`, `ShareIntake`): text, links or up to 5 images from any app land in
  the message box and upload tray.
- **In-app updates** (`UpdateChecker`, `VersionManifest`): reads `apps/chat/public/android/version.json` every
  12 hours; downloads the APK, checks package, version and signing key, then opens Android's installer.
- **CI:** `.github/workflows/android.yml` (unit tests, lint, release APK artifact; "Publish a release" or a `v*` tag
  creates the GitHub Release with `colon-ai-<version>.apk`, `.sha256` and `colon-ai.apk`; tag must match
  `package.json`). `.github/workflows/android-keystore.yml` creates the release signing key into repository secrets
  from a phone (modes `create` / `backup`, optional encrypted backup artifact).
- **Web native-shell integration:** `Colon.native` (`packages/ui/js/colon/native.js`) detects the app and sets
  `html[data-shell="android"]`; `apps/chat/src/lib/native-shell.js` syncs theme and session and drops shared content
  into the composer; links and "Open browser" open native tabs (AI Browse stays in the panel); blob exports save
  through the app; voice uses Colon speech in the app. Settings › App and Help show a "Get the Android app" row on
  the web (APK on GitHub Releases) and the installed version with "Check for updates" inside the app
  (`apps/chat/src/components/app-row.js`); Colon Browser web Help has the same row.
- **Polish** (`packages/ui/css/polish.css`): Android shell safe-area handling, no long-press callouts on controls,
  and refined states, spacing and motion of existing components (no layout changes).
- Tests: 17 JVM unit tests (`LogicTest.kt`, `UrlRulesTest.kt`), `packages/ui/test/native.test.js` (6),
  `scripts/deploy/android-version.test.js` (2).
### Fixed
- **Settings opened scrolled to the bottom** on phones (scrollTop ≈ 3450 at 360 px): hiding the composer on a page
  resized it, and the "follow the latest message" handler pulled the shared scroll area down. Pages now always open
  at the top; returning to a conversation still opens at the latest message.
### Not yet (stubbed)
- **Push notifications (FCM):** channels and the Android 13 permission only; needs a Firebase project.
- **Backend bridge server:** today's API only says hello on `/ws`; no Saga commands yet (the app shows this and
  keeps working).
- Native SpeechRecognizer dictation, Google sign-in inside the app (Custom Tab), App Links (`assetlinks.json`),
  crash reporting, and testing on real low/mid/high-end phones.

## [0.6.5] — 2026-11-13 · Hands-free conversation
### Added
- **Hands-free mode** (`apps/chat/src/lib/hands-free.js`): pick "Hands-free conversation" at the bottom of the mic's
  language list. Colon listens, sends when you stop talking, reads the reply aloud, then listens again. A
  "Hands-free" pill above the composer shows Listening / thinking / speaking with an End button; Cancel on the
  recording bar or tapping the mic also ends it. Two turns in a row with no speech end the session.
- End of a turn: 1.6 s without new words (English dictation) or 1.5 s below speech level on the microphone (Colon
  speech for Naijá, Yorùbá, Hausa, Igbo); 9 s of nothing counts as a miss. `ChatMedia` gained `onLevel`, and a
  failed or empty Colon transcription now reports an empty final transcript so the loop can move on.
- Tests: `packages/ui/test/hands-free.test.js` (3).

## [0.6.4] — 2026-11-13 · Done button fix
### Fixed
- **Tapping Done could leave the mic stuck** on Android: if Done landed between two dictation restarts, Chrome had
  no session to end and never fired `onend`, so the bar stayed open and nothing reached the message box. Done now
  finishes with the words so far if `onend` hasn't arrived within a second.

## [0.6.3] — 2026-11-13 · Dictation text fix
### Fixed
- **Spoken words appeared several times** in the message box on Android ("hi hi how hi how are you…"): Chrome
  repeats earlier words inside each new result. The dictation text is now rebuilt from the results each time, and a
  result that already holds the text so far replaces it rather than being added.

## [0.6.2] — 2026-11-13 · Voice fix
### Fixed
- **English dictation stopped after about 5 seconds** on Android: Chrome ends a speech session at the first short
  pause even with `continuous` on. The mic now restarts the session quietly and keeps the words heard so far until
  you tap Done (5-minute cap). A pause with no speech no longer ends the recording. The bar says "tap Done when you
  finish" for dictation too.

## [0.6.1] — 2026-11-13 · Spoken replies
### Added
- **Read aloud in Nigerian voices:** `POST /voice/speak` (`{ text, lang, speaker }` → MP3, ≤ 900 characters) with
  Naija Speech voices for Yorùbá, Hausa, Igbo and Nigerian English (female/male per language); the language is
  detected from the reply. Markdown, code, links and emoji are not read. Last 40 chunks cached in memory.
  Limits: 300 chunks an hour signed in, 60 for guests, and at most `VOICE_TTS_PER_MINUTE` (default 7) a minute for
  the whole app, since the key allows 10 requests a minute in total. Logs `tts_ok` / `tts_failed`.
- **Client** (`apps/chat/src/lib/read-aloud.js`): plays a reply chunk by chunk (≈120 characters first, then ≤ 300),
  fetching the next chunk while one plays; falls back to the phone's voice when Colon voices are off, busy or
  offline. Settings › Voice: read-aloud voice (Automatic / Colon / phone) and Colon voice (female / male).
- **Language first:** tapping the mic opens a small list (English, Naijá, Yorùbá, Hausa, Igbo, Mixed) above it;
  picking one remembers it and starts recording. The recording bar shows the language and no longer has a picker.
### Changed
- Read-aloud "Automatic" uses Colon voices for Yorùbá, Hausa and Igbo replies and the phone's voice for English and
  Naijá: Naija Speech generates slower than real time (measured 9–18 s for 70–130 characters, one request at a time),
  which is fine where no phone voice exists but slower than the phone for English.

## [0.6.0] — 2026-11-13 · Voice input (Phase 6 begins)
Speak to Colon in English, Naijá, Yorùbá, Hausa or Igbo; the words land in the message box to check before sending.
Details: `docs/phases/phase-6-voice.md`.
### Added
- **Voice module** (`services/api/src/modules/voice`): `POST /voice/transcribe` (multipart `file` + `lang`,
  12 MB / 5 minutes) and `GET /voice/status`. Signed-in users 60 recordings an hour; guests 20 an hour per IP (own
  origins only, follows the guest-chat switch). Logs `voice_ok` / `voice_failed` with provider, language and time.
- **Providers:** Naija Speech API (free; NCAIR / N-ATLaS ASR models) leads for Hausa, Igbo, Yorùbá and Nigerian
  English; a Gemini model (`VOICE_GEMINI_MODEL`, default `gemini-3.5-flash-lite`, on `GEMINI_API_KEY`) handles Pidgin
  and "Mixed" and is the fallback. Recordings are never stored.
- **Composer:** "Colon speech" voice method. The recording bar has a language picker (remembered in Settings), a
  level meter and a "Transcribing…" state; a failed transcription falls back to a voice note (signed in).
  Recording is mono with noise suppression at 24 kbps Opus, about 180 KB a minute on slow networks.
- New env: `VOICE`, `NAIJA_SPEECH_API_KEY`, `NAIJA_SPEECH_BASE_URL`, `VOICE_GEMINI_MODEL`, `VOICE_MAX_SECONDS`.
- Settings › Voice: Naijá and "Mixed / not sure" languages, model attribution (required by the NCAIR licence).
### Changed
- Voice method "Automatic": English uses the browser's live dictation when it has it; every other language uses
  Colon speech.

## [0.5.11] — 2026-11-13 · N-ATLaS and Phase 5 complete
Closes Phase 5 (Intelligence & evaluation).
### Added
- **N-ATLaS on Langa**: the `natlas` provider defaults to `https://langa.julimer.com/v1` (model `n-atlas`); it turns on
  only when `NATLAS_API_KEY` is set and stays third in the African-language chain. New env `NATLAS_MAX_TOKENS`
  (default 2048): a provider-level output cap (`client.capTokens`), so Developer mode's 8192 never reaches the host.
- Small N-ATLaS bench `bench/results/natlas-2026-11-13` (Hausa, Igbo, Yorùbá, 2 items each): 3/6, ~0.9 s first token
  (Gemma 4 26B: 4/6 on the same items). Not enabled in production: Langa's free plan is 12,500 tokens/month.
- Benchmark 2026-11-12 complete (Mistral Large 4 with `reasoning_effort: 'low'`; `'none'` answers 400).
### Changed
- Built-in specialist table: Everyday no longer goes to MiniMax; after the complete rerun Gemma 4 26B leads every
  category (MiniMax still last for Yorùbá, Hausa, Igbo).
### Fixed
- Two stale unit tests (Mistral body, specialist table) that failed after the benchmark rerun.
- Version 0.5.11 everywhere.

## [0.5.10] — 2026-11-13 · Specialist routing
Phase 5 specialist routing: where a model clearly beats Saga's default on a kind of request, it leads the chain for
those requests. Details: `docs/phases/phase-5-specialist-routing.md`.
### Added
- **Task classifier** (`ai/classify.js`, rule-based, no model call): category = the African reply language (Naijá,
  Yorùbá, Hausa, Igbo; reuses `prompts.detectLanguage`), else code / reasoning / exam / research / everyday from the
  mode, the message and attachment names.
- **Specialist derivation** (`ai/specialists.js`, pure): from the newest imported benchmark, per category; a model
  leads only when complete in the benchmark and ≥5 points better than the default plus 0.5 point per second of
  slower first token, with a median first token ≤15 s. Complete models under 70 in a category, and MiniMax for
  Yorùbá/Hausa/Igbo, go last. Built-in table (bench 2026-11-12) when no benchmark is imported. Re-derived on import.
- From bench 2026-11-12: Everyday → MiniMax M3.1 Flash; every other category keeps Gemma 4 26B; MiniMax goes last
  for Yorùbá, Hausa and Igbo (Gemma 4 31B wins Hausa on score but is ~18 s to first token, so it stays second).
- **Admin › Routing**: Specialist routing card (per-category head, reason, demoted models, rule, source) and an
  On/Off switch saved with the routing setting; `GET /admin/routing` returns `specialists`, `PATCH` accepts
  `specialists: true|false`. New optional env **`AI_SPECIALIST_ROUTING`** (on|off, default on) when the switch was
  never saved.
- **Admin › Evaluation › Import benchmark** button (posts a `bench/results/<run>.eval.json` to
  `POST /admin/evaluation/bench`).
- `ai_reply_ok` in stderr.log carries `route=specialist:<category>` / `default:<category>` / `default`.
- Tests (11 new): classifier, derivation (margin, latency, incomplete exclusion, demotion, no-eval fallback, static
  table = committed bench), chain reordering, hedge waves, settings switch, import time parsing; integration with
  the mock provider and the admin routing handlers.
### Changed
- Specialists only reorder the head of the chain (and push weak models last); fallback, resting and hedging are
  unchanged, except that a hedged wave no longer pulls a demoted model forward to mix providers.
- Benchmark import accepts the report's local "finished" time (`Thu 2026-11-12 1:52 PM WAT (UTC+01:00)`), so the
  committed 2026-11-12 file imports as is; importing or deleting a run clears the routing cache.
- The routing loader reads the newest benchmark rows from `eval_runs` (one extra query per 30 s per worker).
- Version 0.5.10 everywhere.
### Not changed
- No migration, no new route, no new dependency; the configured routing order is the fallback order.

## [0.5.9] — 2026-11-13 · Developer mode
Phase 5 Developer mode: code explain, fix, generate and review, and a project-files context. Details:
`docs/phases/phase-5-developer.md`.
### Added
- **Developer prompt** (`ai/prompts.js`): explain (walk-through, complexity, pitfalls); fix (name the bug, root cause,
  corrected code as a minimal diff or the full file, how to test); generate (complete runnable code, file names,
  dependencies, run instructions); review/refactor by severity. Fenced code blocks with language tags; code and
  identifiers in English, prose in the reply language; never invent APIs, say when unsure; secure by default (no
  hard-coded secrets, parameterised SQL, input validation); one clarifying question only when essential; Nigerian
  context (cPanel hosting, Paystack/Flutterwave) when relevant.
- **Larger output for Developer replies**: new optional env `AI_DEVELOPER_MAX_TOKENS` (default 8192; other modes keep
  `AI_MAX_TOKENS`). Routing order unchanged.
- **Project files**: attach code files or a `.zip` of a project (20 MB, kind `doc`, mime `application/zip`; other
  ZIP-based files are still refused; more code extensions accepted). The zip is read once at upload into a snapshot
  (`modules/developer/snapshot.js`): top folder stripped; `node_modules`, `.git`, `vendor`, `dist`, `build` and
  other tool folders counted but not read; binaries, images, minified bundles, lockfiles (size only) and secret
  files (`.env`, keys; `.env.example` is read) listed without contents.
- **Project context** for every Developer reply (`modules/developer/project.js`, `chat/context.js forMode`): code
  files and snapshots from every message in the conversation (follow-ups keep them; a re-attached file replaces
  the old copy), ordered by files named in the message, then entry points/configs, then smallest code first, within
  48,000 characters (12,000 per file, 24,000 for a named file). A header with counts and languages and a file tree
  marking every truncated or omitted file and why; the model is told not to guess missing files. Tree and files are
  untrusted: neutralised by the injection guard and fenced per file with random end markers. Guests get a plain
  rendering from `/chat/guest/extract`.
- **Safe ZIP reader** (`extract/zip.js`), now shared with DOCX/PPTX/XLSX/ODT: path traversal, absolute paths and
  NUL names refuse a project archive (422 `unsafe`); zip bombs refused by declared total (128 MB), ratio (200× for
  entries over 1 MB) and entry count (20,000); every entry inflated with a cap at its declared size.
- **Developer quick actions** in the chat app: Explain, Fix a bug, Generate, Review (prefill a short template) and
  Attach project, shown above the composer in Developer mode only. Help FAQ: "How do I get help with my code?".
- Tests (13 new): prompt contents and output cap; snapshot ignore rules, traversal and zip-bomb refusal; context
  priority, budget, truncation and omission notes, merging, injection fencing; chat context per mode; and an
  integration test with the mock provider (the stored zip reaches the model as context and a follow-up reuses it).
### Changed
- Code blocks never widen a message on phones (`max-width`, horizontal scroll contained); they already had the
  language label and Copy.
- Version 0.5.9 everywhere.
### Not changed
- No migration, no new route, no new dependency; routing order as configured.

## [0.5.8] — 2026-11-13 · CBT: fresh questions every test
### Fixed
- **CBT tests no longer repeat themselves.** The same exam + subject + topic used to send the model the identical
  prompt with no memory of earlier tests and no temperature, and only exact-text duplicates were removed, so tests
  came back nearly the same. Now:
  - **Memory of recent tests** (app, `core/cbt-store.js`): the last 40 question stems (140 characters each) per
    exam + subject + topic are kept in `localStorage` (12 kinds, ~40 KB at most; oldest rotate out; bad JSON is
    ignored) and sent with every new test and Retake as `avoid`.
  - **`POST /study/cbt` accepts `avoid`** (optional; up to 40 strings, one line, 160 characters each, 5000 in total).
    They reach the prompt as quoted data items, never as instructions: "do not repeat or closely paraphrase these;
    if you test the same concept, change the angle, numbers, context and options".
  - **A random focus per request** (`modules/study/variety.js`): a shuffled set of syllabus areas to spread over (at
    least 6; built-in lists for the quick subjects, otherwise a random starting area in the model's own syllabus
    order), or with a topic, at least 6 angles on it; a random mix of question types (recall, application,
    calculation, interpretation, error-spotting) and a random variety token. Temperature 0.9 for CBT generation.
  - **Near-duplicate filter** (`modules/study/similar.js`): stems are compared as token sets (no punctuation or stop
    words, plurals folded; Jaccard ≥ 0.6, or ≥ 0.4 with the same correct option). Different numbers = a new
    question. Applied within the test and against `avoid`. A short first answer is topped up by the second call,
    which also avoids the stems already accepted; still short after two calls, items held back only for resembling
    an earlier test fill the gap (never an in-test duplicate) and `cbt_short` is logged.
- Unit tests for the avoid input, the similarity filter, the focused prompt (fixed rng), temperature and top-up.

## [0.5.7] — 2026-11-13 · Study mode tools
### Added
- **Quizzes** in Study mode: Colon Saga settles the subject and level, asks one WAEC/JAMB-style A–D question at a
  time (5 by default), waits for the answer, marks it with a short explanation and a running score, and ends with the
  score, weak topics and what to revise.
- **Flashcards**: 10 by default, as a Markdown table (#, Front, Back), basic to harder, with an offer to quiz on them.
- **Past-question practice**: never presents a made-up question as a real WAEC, NECO, JAMB or university past
  question; generated ones are labelled "WAEC-style"/"JAMB-style". Pasted past questions are solved step by step,
  with the option letter, marking-scheme-style working for theory, and one similar practice question.
- **CBT practice test** (`#/cbt`, from Explore › Study, "CBT practice" in the menu and the Help FAQ): pick WAEC,
  NECO, JAMB, University or General, a subject (quick chips) and an optional topic, then answer exactly 10 objective
  questions (A–D) in 5:00 for the whole test, laid out like the JAMB CBT: countdown (warning at 1:00, red at 0:30,
  screen-reader announcements), question navigator with flags, keyboard shortcuts (A–D, N/P or arrows, F) and
  Submit with an unanswered count. The test submits itself at 0:00 ("Time up — submitted"); the timer counts to an
  absolute end time kept with the answers in `sessionStorage`, so a refresh resumes with the right time left. The
  results show the score, time used and every question with your answer, the right one and why, plus Retake (new
  questions), New test and "Discuss my mistakes" (a Study chat prefilled with the missed questions). Preview mode
  (no connection) shows a friendly "needs a connection" notice.
- **`POST /study/cbt`** (new `modules/study`, route `http/routes/study.js`): open to guests (when guest chat is on)
  and signed-in users, 5 tests per 10 minutes per IP, counted as one Study-mode reply against the daily limits (given
  back when no test could be made), subject and topic run through the safety input check. The model is asked for
  strict JSON; the reply is repaired (fences, LaTeX backslashes, trailing commas, cut-off items) and every item
  checked (4 distinct options, one answer A–D); numeric answer keys that contradict the explanation's own working are
  corrected, and options are shuffled so the right letter varies. Under 10 valid questions → one retry (questions
  pooled), then a 502 with a friendly message. Unit tests for the parser, prompt, input and handler.
- Help page mentions the Study tools. Unit test for the Study prompt.

## [0.5.6] — 2026-11-13 · Benchmark rerun fixes
Gets the four models that failed or stopped in the first benchmark (`services/api/bench/results/2026-11-12.md`)
ready for a rerun: DeepSeek V4.1 Flash and GLM-5.3 Flash (100 % first-token timeouts on NVIDIA), Nemotron 3.5
Lightning (stopped at 130/135) and Mistral Large 4 (stopped at 42). Root causes and the rerun steps:
`docs/phases/phase-5-benchmark.md`.
### Fixed
- **GLM-5.3 Flash** now sends `reasoning_effort: low` (NVIDIA's default is `max`), in Saga's routing and in the
  benchmark. New optional env `NVIDIA_GLM_REASONING` (`low`, `high`, `max`, or `default`).
- **Nemotron 3.5 Lightning** is benchmarked with `reasoning_budget: 1024` and 4096 max tokens: its reasoning counted
  against 2048 max tokens and 16 replies ended at `finish_reason: length` with no answer.
- **Mistral Large 4** sends `reasoning_effort: none` explicitly. DeepSeek, GLM and Mistral get 180 s to the first
  token (NVIDIA free-tier queueing), Nemotron 120 s.
### Added
- **Resume from checkpoint**: `npm run bench -- --resume [run]` continues a stopped run with the same flags; a
  `<model>.status.json` per model (`running`, `done`, `stopped`, `unreliable`, `failed`); Ctrl-C/SIGTERM marks
  running models `stopped`. Each row carries a settings fingerprint, so answers made with other settings are asked
  again instead of being mixed in. `--reset-unreliable`.
- **Provider-wide limits**: one limiter per provider for all its models (NVIDIA: 30 requests/min, 4 in flight by
  default; `--rpm-nvidia`, `--inflight-nvidia`, `BENCH_RPM_NVIDIA`).
- **Retries**: `Retry-After` is honoured on 429/503, exponential back-off with jitter; 400/401/403/404 are never
  retried, and a wrong key or model id stops that model at once.
- **Clear error reasons** per item: code, HTTP status, where it stalled (`connect` = no response headers, the host is
  queueing; `first_token`; `idle`; `max`), reasoning chunks seen, attempts and time, plus an attempt log. Replies cut
  at the token cap say so. The report lists errors by reason per model.
- `npm run bench -- --probe`: one tiny request per model (headers, first reasoning chunk, first answer, finish
  reason) before a long run.
- The provider client attaches `retryAfterMs` and the stall `phase` to its errors (no change to what users see).
- Tests (10 new, mock provider): retry policy, limiter, stall phases, cut-off replies, fatal stop, per-model options,
  checkpoints, probe, and the CLI stopped with SIGTERM then resumed end to end.
### Changed
- Version 0.5.6 everywhere.
### Not changed
- No route, migration or app screen changed; the 2026-11-12 results are kept as they were.

## [0.5.5] — 2026-11-13 · Safety layer
Phase 5 safety: harmful-content filtering on what users send and what the model streams back, prompt-injection
guards for web pages and uploaded files, and an Admin › Safety view. Rule-based and in process (no model, no new
dependency, ~2 ms per message), with lists in English, Nigerian Pidgin, Yorùbá, Hausa and Igbo. Decision record:
`docs/decisions/0003-safety-layer.md`.
### Added
- **`services/api/src/modules/safety/`** (facade `index.js`): `normalize.js` (one folding pass: tone marks, invisible
  characters, look-alike digits, spaced-out letters), `rules.js` (co-occurrence rules with benign-context
  exceptions), `data/*.js` (one file per category), `classify.js`, `policy.js` (settings per audience), `care.js`
  (model guidance), `messages.js` (refusals, stop notice and helplines in five languages), `redact.js`,
  `injection.js`, `output.js`, `provider.js`, `events.js`.
- **Input moderation before the model call** on every chat route (send, regenerate, edit, guest). Categories:
  child sexual content (always refused, cannot be switched off, fail closed), self-harm (never refused: a supportive
  message with Nigerian helplines first, then a careful answer), weapons/explosives/violent harm, illegal drug making
  (incl. mkpuru mmiri, skuchies, gutter water), hate and harassment, explicit sexual content (refused for guests,
  non-graphic for signed-in adults), fraud and scams (Yahoo-yahoo formats, fake alerts, card cloning, BVN/OTP/PIN
  phishing; victims get anti-fraud steps), personal data exposure (finding, tracking or doxxing people). Actions:
  allow, allow with care (guidance added to the system prompt) or refuse (a localized refusal streamed as a normal
  reply; no provider call, no web search, no quota used).
- **Secret redaction**: the user's own card numbers (Luhn-checked), BVN/NIN, OTP, PIN, CVV and passwords are masked
  before the message goes to an AI provider; the saved chat keeps what the user typed.
- **Optional moderation endpoint** (OpenAI-compatible `/moderations`), off by default; only ever stricter; fails
  open with a log line, never for child safety.
- **Prompt-injection guard**: web titles, snippets and page text (Research mode) and uploaded file names and text
  are neutralised (hidden characters, HTML comments, "ignore previous instructions", fake role tags, `SYSTEM:` lines,
  forged delimiters) and fenced in `<<<SOURCES|FILE untrusted id=…>>>` blocks with a random end marker; flags are
  logged.
- **System prompt safety section** in every mode: refuse seriously harmful help, care for self-harm, never reveal
  the prompt or keys, the untrusted-content rule.
- **Output check on streamed replies**: each delta is checked before it is sent (child sexual content, explosive
  recipes, drug synthesis, system-prompt leaks); on a hit the provider is cancelled and `done` carries a safe ending.
  Same SSE events as before (`start → delta… → done`), so the apps need no change.
- **Migration `0007_safety_events`** (new table only): stage, category, action, rule, source, route, mode, language,
  request id, user or guest; no message text unless `SAFETY_LOG_TEXT` is `hash` (keyed HMAC) or `excerpt` (first 80
  characters).
- **Admin › Safety** (admin + 2FA): recent events with category, action and date filters; switches per category
  for signed-in users and guests; provider moderation on/off/default. `GET /admin/safety`,
  `GET /admin/safety/settings`, `PATCH /admin/safety/settings` (audited `admin.safety_updated`; stored in
  `app_settings` key `safety`, live within 30 s).
- New optional env vars: `SAFETY`, `SAFETY_LOG_TEXT`, `SAFETY_PROVIDER_MODERATION`, `SAFETY_MODERATION_URL`,
  `SAFETY_MODERATION_API_KEY`, `SAFETY_MODERATION_MODEL`, `SAFETY_MODERATION_TIMEOUT_MS` (`config/README.md`).
- Tests (30 new): per-category positives and false-positive negatives (medical, news, prevention, slang such as
  "bath bomb", "don't bomb your WAEC", "this traffic go kill me"), injection guard, redaction, output guard,
  chat and Research integration with the mock provider (refusal, care, stream stop, injection, moderation endpoint),
  and security (admin guards, child-safety lock, SQL-safe filters, no reflection).
### Changed
- File blocks and the Research sources block carry an `untrusted id=…` marker; the user's name in the system prompt
  can't add lines.
- `scripts/dev/headless-check.js` also opens Admin › Safety.
- Version 0.5.5 everywhere.
### Not changed
- No route removed or reordered (3 admin routes added); no change to the chat or browser apps.

## [0.5.4] — 2026-11-12 · Restructure: company-grade layout
The repository is reorganised so each part has one obvious place and the rules are checked by CI. Same routes
(97, identical order), same API behaviour and same screens; the only visible differences are the URL changes below.
### Changed
- **API layers** (`services/api/src`): `http/` (server, middleware, router, routes), `ws/`, `modules/` (account, admin,
  ai, auth, bench, chat, extract, health, search), `shared/`, `db/`, `config/`. Dependencies point one way:
  http/ws → modules → shared/db/config.
- **Thin routes**: `http/routes/{health,auth,account,admin,chat}/` only wire paths to guards, rate limits and handlers;
  handlers live in `modules/*/handlers/`.
- **Module facades**: every module has an `index.js`; other code imports a module only through it.
- **One file per provider**: AI providers in `modules/ai/providers/` (hedged racing in `hedge.js`), web search
  providers in `modules/search/providers/`; text extraction split by file type (`sniff`, `image`, `docx`, `pdf`,
  `text`).
- **Tests split**: `services/api/tests/{unit,integration,security,e2e,helpers,fixtures}` (same 87 tests).
- **Config validated at boot**: one schema (`src/config/defaults.js`); production refuses to start without
  `DB_USER`/`DB_NAME`, and any non-numeric value in a numeric variable (or a malformed URL) stops the API with a
  message listing every problem. `.env.example` → `config/api.env.example`, every variable documented in
  `config/README.md`.
- **Request ids**: every response has an `X-Request-Id` header and every log line for that request carries `req_id`.
- **e2e** scripts fixed for Gemma-first routing (`config/e2e.env.example`, mock provider in every slot).
- **Frontend**: classic scripts → ES modules, split into `core/`, `pages/`, `components/` and `actions/` per app;
  the UI kit into `packages/ui/js/{colon,markdown,browser}/` behind its entry files; CSS split per concern
  (`packages/ui/css/*`, `apps/*/public/assets/css/*`); fonts in `packages/ui/fonts`, brand in `packages/brand`.
  `window.Colon` and the other globals keep their keys. The version shown in Help and Settings now comes from
  `Colon.version`.
- **Versioned deploy**: `scripts/deploy/build-docroot.sh` (run by `.cpanel.yml`) puts each release's modules under
  `/v<version>/` and copies `index.html` last; `.htaccess` is never written.
- **`scripts/check.js`** enforces syntax, ≤300 lines per file, ≤120 characters per line, API layer rules, app import
  rules, one version everywhere, and `config/api.env.example` matching the config schema.
- **Docs**: `docs/adr` → `docs/decisions`, phase notes → `docs/phases`; `docs/architecture.md` rewritten; new runbooks
  (`docs/runbooks/`: deploy, rollback, key rotation, backup and restore) and `docs/security/threat-model.md`.
- Dev tools: `scripts/dev/headless-check.js` (Playwright), `static-server.js`, `linkcheck.js`, `cycles.js`.
### URL changes
- Favicon is the SVG file `/v<version>/packages/brand/assets/colon-mark.svg` (admin: `colon-admin-mark.svg`)
  instead of an inline data URL.
- The Preview model list moved to `assets/config/models.json`.
- `/ui/` on the app subdomains now only mirrors the fonts (`/ui/fonts/`) for older pages; the kit itself loads from
  `/v<version>/packages/ui/`. `/brand/` keeps its old files.
### Not changed
- No other behaviour change: same API routes and responses, same database schema (no new migration), same
  screens.

## [0.5.3] — 2026-11-12 · Phase 5: web search with cited sources (Research mode)
Research mode now looks things up on the web before answering and cites what it found with tappable [1], [2] chips and a Sources list. Free and keyless by default; never breaks chat. Details: `docs/phases/phase-5-research.md`.
### Added
- **Web search** (`services/api/src/search/`): pluggable providers behind one interface `search(query, { limit, lang, signal }) → [{ title, url, snippet }]`. Keyless chain **DuckDuckGo** (html endpoint, lite as a second try, `uddg` redirects unwrapped, ads dropped) → **Wikipedia** (English, plus the Naijá/Yorùbá/Hausa/Igbo Wikipedia when the reply is in that language). Optional keyed providers, only used when configured: **Brave Search API**, **Tavily**, **SearXNG** (base URL). A provider that shows a captcha/anomaly page is marked blocked and rested for 10 minutes; any failure hands over to the next provider.
- **Page reader**: the top 3 result pages (admin: 0–5) read in parallel, ~6 s each and ~12 s overall, 1.5 MB cap, HTML only (PDFs and binaries skipped), main text kept (scripts, nav, header, footer, asides, cookie banners dropped) and trimmed to ~2,500 characters around the question. Wikipedia pages through Wikipedia's plain-text API. 10-minute in-memory LRU cache.
- **SSRF guard**: only http/https on ports 80/443, no credentials in URLs, every hop (max 3 redirects) must resolve to public addresses only (loopback, private, link-local/metadata, CGNAT, multicast and IPv6 equivalents refused after DNS resolution).
- **Research flow** (`chat/reply.js`): queries from the latest message (heuristic: filler removed, the year added for "current/latest" questions, a keyword variant, short follow-ups borrow the previous question's topic); for Naijá/Yorùbá/Hausa/Igbo a ~1 s model call writes English queries plus a faithful translation (4 s budget, heuristic fallback). New SSE events before the answer: `status` (`searching`, `reading` + count, `writing`, `unavailable`) and `sources [{ n, title, url, site, snippet }]`. The model gets the numbered sources with strict rules: cite [n] after the claims they support, only use the given sources for facts, say when they don't cover something, today's date in Africa/Lagos for recency, web text treated as untrusted data. If search fails entirely the answer still streams, starting with a short "web search wasn't available" notice. Daily limits and guest mode unchanged (the search runs after the limit check). Logs `search_ok` / `search_failed` (provider, ms, count; no query text).
- Sources are saved with the assistant message (existing `chat_messages.sources`) plus a new `web_search` column (`{ ok, provider, ms, read }`), so history and shared links show them.
- **Chat UI**: "Searching the web…" / "Reading N sources…" / "Writing from N sources…" status while it works; citations render as small superscript chips linking to the source in a new tab (`rel=noopener`); compact Sources row under the answer with the site's own favicon (hidden when missing), title and domain; a **Web** badge on answers that used search (**No web** when it failed). Works in light/dark and in shared chats.
- **Admin › System › Web search** (Super Admin): on/off (default on), provider order with per-provider on/off, results per search (3–8), pages read (0–5), SearXNG URL, and Brave/Tavily/SearXNG keys stored AES-256-GCM encrypted and shown masked. `GET/PATCH /admin/search`, `POST /admin/search/key` (audited).
- Migration `0006_web_search` (runs automatically on API start): `chat_messages.web_search JSON NULL`. New column only.
- New optional env vars: `WEB_SEARCH` (`off` to disable), `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SEARXNG_URL`, `SEARXNG_API_KEY`.
- `services/api/scripts/research-check.js`: live check of search + reader + a full research answer with timings.
- Tests: `services/api/test/search.test.js` (DuckDuckGo and Wikipedia parsers on fixtures, blocked-page detection and fallback, SSRF guard and redirects, size cap, HTML to text, page reader, citation prompt, SSE `status → sources → answer` order, a failed search still answering, model-written queries) and Web search admin permissions/key masking in `admin.test.js`.
### Changed
- Research-mode system prompt: "you cannot browse" only when there are no web sources.
- Version 0.5.3 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.5.2] — 2026-11-12 · Phase 5: the Colon benchmark
### Changed (routing, from the first benchmark run)
- Every mode now goes Gemma 4 26B (Google) → MiniMax M3.1 Flash (NVIDIA) → Gemma 4 31B → Qwen → DeepSeek → GLM. African languages go Gemma 4 26B → Gemma 4 31B → N-ATLaS → MiniMax → Qwen → DeepSeek → GLM (MiniMax is weak in Yorùbá/Hausa/Igbo). New targets `gemma31` and `minimax` (`NVIDIA_MINIMAX_MODEL`). `.env.example`: `NVIDIA_GEMMA_MODEL` empty (NVIDIA's Gemma 4 31B is gone).
### Results (first run, 2026-11-12, `services/api/bench/results/2026-11-12.md`)
- Gemma 4 26B (Google) 94.6, fastest (0.8 s first token), wrong answers 0 (all 6 misses were Google 500s). MiniMax M3.1 Flash 88.9 (weak Yorùbá/Hausa/Igbo). Gemma 4 31B 83.5 (21 s first token). Gemini 3.5 Flash Lite 96.8 (reference only). DeepSeek V4.1 Flash and GLM-5.3 Flash (NVIDIA) answered nothing. Nemotron and Mistral Large 4 incomplete.
Saga's default is now chosen by benchmark score, and a model can only go into routing after a fresh benchmark. Details and the score formula: `docs/phases/phase-5-benchmark.md`. First live run: `services/api/bench/results/2026-11-12.md`.
### Added
- **The Colon benchmark** (`services/api/bench/sets/*.json`, suite `colon-bench-1`, 135 original items): Nigerian everyday questions, WAEC-style, JAMB-style, university study, coding, reasoning, tool use (tool calls and structured JSON), and Naijá, Yorùbá, Hausa and Igbo. Everything is graded automatically: multiple-choice letters, numbers (`Answer:` line, ₦, commas, fractions), accent-insensitive keywords and regex, JSON parsed and checked against a schema subset and expected values, JavaScript run against unit tests in a **sandboxed child process** (fresh `vm` context, no `require`/`process`/network, CPU and wall-clock timeouts), and a target-language check (function words vs English, plus subdots/tone marks/hooked letters). Optional LLM judge for the language sets (`--judge`).
- **Runner** `npm run bench` (`services/api/scripts/bench.js`, core in `src/bench/`): asks every candidate through the app's own provider client with Saga's real system prompt per mode and language, and records per item the score, first-token and total time and errors. Polite to free tiers: one or two requests at a time per model (per provider with `--concurrency-<provider>`), a gap between items, two retries with back-off on 5xx/timeouts, and longer waits on 429 that don't count as failures. A model with more than 50 % errors after 20 items is stopped as **unreliable**. Resumable (`--run`, `--retry-errors`), re-gradable from saved replies (`--report --regrade`). Writes `bench/results/<run>.md` (scoreboard and every failure), `.json` and `.eval.json`.
- **Score**: `100 × (0.60 accuracy + 0.15 language quality + 0.10 speed + 0.15 reliability)`; cost is recorded ($0 on the free tiers) and breaks ties.
- **Admin › Evaluation** shows benchmark runs: `--save` writes them to `eval_runs`, or post `bench/results/<run>.eval.json` to the new `POST /admin/evaluation/bench`. `GET /admin/models` shows each model's latest benchmark score.
- **The model-change gate** (`src/bench/gate.js`): adding a model, changing a model's id or host, switching one back on, or giving a mode a new first choice in Routing is refused with `409 needs_benchmark` unless a finished benchmark of exactly that provider + model is newer than `BENCH_MAX_AGE_DAYS` (default 30). A Super Admin can skip it once with a written reason (audited); `BENCH_GATE=off` turns it off. CLI: `npm run bench -- --gate provider:model`.
- Migration `0005_bench`: new `eval_runs` columns (`kind`, `provider`, `suite`, `items`, `error_rate`, `first_token_ms`, `details`) and an index.
- Tests: `services/api/test/bench.test.js` (graders, sandbox, every coding item solvable by a reference solution, aggregation and the score, the runner against a mock provider including retries, 429 waits and the unreliable stop, the report, the gate and its wiring into the admin routes).
### Changed
- Version 0.5.2 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.5.1] — 2026-11-12 · Fix: Delete account tap
### Fixed
- The decorative COLON intro wordmark could sit over Settings › Account › **Delete account** and swallow taps on the middle of the row. The intro artwork now has `pointer-events:none`, the faded intro drops behind the page (`visibility:hidden`, `z-index:-1`) and is removed after a tap-to-skip, and the decorative brand marks (`.logo-mark`, `.auth-mark`, `.cw-hero-mark`) never take a tap.
- Version 0.5.1 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`, so phones load the fixed CSS instead of a cached copy.

## [0.5.0] — 2026-11-12 · Phase 4: Admin Dashboard
Every platform setting can now be changed from admin.apparatus.name.ng, and each role sees only what it is allowed to (enforced by the API; every change is audited). Details: `docs/phases/phase-4.md`.
### Added
- **Overview** from stored data: users, chat requests and failures, provider success rates and reply latency, top errors and open reports (new `ai_calls` log, one row per provider attempt, kept 30 days).
- **Models and providers**: add, edit, enable and disable providers and models in the database. Provider API keys are **Super Admin only**, stored AES-256-GCM encrypted (key from `APP_SECRET`) and only ever shown masked (`••••1234`). Environment keys stay the fallback; the first model edit copies the built-in table into the database.
- **Routing** per mode (General/Saga, Study, Developer, Research and the African-languages route): ordered model list with fallbacks, plus the hedge count. **Live, no redeploy:** each worker re-reads within ~30 s. If the database config is empty, broken or leaves no usable model, routing falls back to `routing.js` (chat never breaks).
- **Usage and limits**: member, guest and guest-per-IP daily limits, optional per-mode daily caps, and a per-user override, all editable live.
- **Users**: search and filters (staff, suspended), user page with sessions (revoke one or all), recent sign-in events, role, daily limit, and **suspend/unsuspend** (a suspended user is blocked at sign-in, including Google, and every session is revoked).
- **Moderation queue**: "bad" feedback on replies plus reports on shared links (new **Report this chat** button on shared chats, `POST /shared/:token/report`), with resolve, resolve-and-turn-off-the-link, dismiss and reopen. Feedback context is hidden when the user turned off sharing feedback.
- **Evaluation** (stub): log benchmark runs, and see thumbs up/down per model and the reasons for bad ratings (full benchmarks are Phase 5).
- **African AI registry**: CRUD list of language models and datasets with languages, licence, licence link, source link, commercial-use and status.
- **Voice**: STT/TTS engine settings (stored only, for Phase 6). **Browser**: placeholder until Phases 8–10.
- **System settings** (Super Admin): product name, feature flags (sign-ups, guest chat, uploads, share links), **maintenance mode** (new chat activity gets `503 {error:"maintenance"}` with your message; staff exempt; history still loads) and an **announcement banner** shown in Colon AI.
- **Security**: staff 2FA status, sign-in counts (24 h), sign-in events and the full audit trail.
- Mobile-first admin UI (`apps/admin/public/js/admin-app.js`, `css/admin.css`): bottom tabs for Overview, Users, Moderation and More; every section in the desktop sidebar.
- Migration `0004_admin` (runs automatically on API start): `app_settings`, `ai_providers`, `ai_models`, `ai_calls`, `user_limits`, `user_suspensions`, `moderation_reports`, `eval_runs`, `african_registry`. New tables only.
- Tests: `services/api/test/admin.test.js` (permission matrix for every admin endpoint, live routing and fallback, settings cache, limits, call log) in `npm test`; `services/api/test/e2e-admin.js` runs the whole dashboard API against MySQL and the mock provider.
### Changed
- Moderators now get moderation plus **read-only** users (unlocking an account and `/admin/stats` moved to Admin).
- `/health` reports `ai.routing` (`database` or `default`). `/auth/config` adds `brand_name`, `features`, `maintenance` and `announcement`.
- Nav items in the UI kit can stay out of the tab bar (`tab: false`) or the sidebar (`side: false`); the shell brand follows the system brand name.
- Version 0.5.0 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.4.4] — 2026-11-11 · ~1 s first reply
- **Gemma 4 26B A4B is the main Google model** (first token ≈0.7–1.2 s in tests); Gemma 4 31B is now the Google backup (often 500/503 or 14 s+).
- **Rolling hedge pool:** two models always in flight; one that fails fast is replaced at once instead of waiting for the slow one.
- **Quick 5xx retried once** on the same model (Google's free tier throws random 500s that succeed on retry).
- NVIDIA Gemma disabled by default (`NVIDIA_GEMMA_MODEL` empty; the model id now 404s on NVIDIA). NVIDIA DeepSeek/GLM stay as backups (free tier queues 7–34 s before the first token).
- `ai_reply_ok` log line (provider, model, ms) in stderr.log so the live winner is visible.

## [0.4.3] — 2026-11-11 · Faster replies: hedged racing
- **Saga asks two models at once** (from different providers, e.g. DeepSeek on NVIDIA and Gemma 4 on Google) and streams whichever starts answering first; the other is cancelled. A slow or overloaded free host no longer adds 25 s of "thinking". If both fail before answering, the next pair is tried. `AI_HEDGE` (default 2; 1 = one at a time).
- Live server log before this fix: NVIDIA DeepSeek first-token timeouts and Google Gemma 500/503 "high demand" errors, tried one after another.

## [0.4.2] — 2026-11-11 · NVIDIA provider (free DeepSeek)
- **New provider: NVIDIA build.nvidia.com** (`NVIDIA_API_KEY`). DeepSeek V4.1 Flash is now the first DeepSeek target (thinking off, answers in about 2–7 s), Gemma 4 31B on NVIDIA is a second Gemma host after Google, and GLM-5.3 Flash is the last fallback on every route.
- Routing targets can now carry per-model request options (`body`).
- Tested live: a Pidgin General question and a Developer question both answered through NVIDIA DeepSeek.

## [0.4.1] — 2026-11-11 · Saga reliability fixes
### Fixed
- **Google AI Studio (Gemma 4)**: Google doesn't serve Gemma models on its OpenAI-compatible endpoint, so every Gemma call failed and Saga answered "couldn't reach an AI provider". The client now talks to the native Gemini API (`/v1beta/models/{model}:streamGenerateContent?alt=sse`, `x-goog-api-key`), sending the system prompt as `systemInstruction`, assistant turns as `model`, images as `inlineData`, and hiding thought parts. New `GEMINI_THINKING` (default `minimal`, or `high`, or `off`).
- A second Google model, Gemma 4 26B A4B (`GEMINI_FALLBACK_MODEL`, `off` to disable), now backs up Gemma 4 31B, so a Google error on one doesn't leave Saga silent.
- **No more endless "thinking"**: the chat app now turns a non-stream answer (such as a hosting firewall page), a stream silent for 90 s, or a stream that closes without finishing into a clear error with Retry.
- warn/error logs go to stderr, so cPanel's `stderr.log` shows provider failures.

## [0.4.0] — 2026-11-11 · Phase 3: Colon AI chat backend, model router v1, guest chat
### Added
- **Chat API** (`services/api/src/http/routes/chat.js`, `uploads.js`): every endpoint the remote chat adapter expects. Conversations (list, search, create, rename, pin, archive, delete one or all, export), streamed replies as server-sent events (`user` → `start` → `delta`… → `done`, or `error {code}`), **Stop** (closing the stream, or `POST …/messages/:mid/stop`, which also reaches another worker), **regenerate** (new version replaces the reply), **edit** a sent message (re-answers from there), AI Browse notes, **feedback** (good/bad + reason + comment, stored with the provider and model for evaluation), **share links** (read-only `GET /shared/:token`, can be turned off), chat settings and stats, and `GET /models` from configuration.
- **Uploads**: images, PDF, Word/PowerPoint/Excel/ODT/RTF, text and code files, and recorder voice notes. The real file signature is checked server-side (a renamed `.exe` is refused), size limits match the app (images 10 MB, documents 20 MB, text 2 MB, 5 per message), and files are stored outside web roots with a per-user quota. Text is extracted once at upload with Node built-ins only: PDFs (including compressed object streams and subset fonts with ToUnicode maps, so Yorùbá tone marks and ₦ survive), DOCX/PPTX/XLSX/ODT (built-in ZIP reader), RTF, and an approximate reader for old .doc/.ppt/.xls. Scanned PDFs say they have no text layer. Images go to a vision-capable model when one is configured; otherwise the reply explains it (`no_vision`).
- **Model router v1** (`services/api/src/ai/`): provider-agnostic OpenAI-compatible streaming client (built-in `fetch`), with Groq (Qwen), OpenRouter (DeepSeek, Gemma 4), Google AI Studio (Gemma 4) and N-ATLaS, each enabled only when its key is set and every model id env-overridable. Routing table in one file (`routing.js`) for Phase 4: Naijá, Yorùbá, Hausa or Igbo replies go DeepSeek → N-ATLaS → Gemma 4 → Qwen; General/Study/Research go Qwen → DeepSeek → Gemma 4; Developer goes DeepSeek → Qwen → Gemma 4. Automatic fallback on errors, 429s, missing models and timeouts before the first token (no silent switch mid-answer), with a short rest for a failed target so it doesn't slow every reply. `<think>` reasoning is hidden. `/health` reports which providers are on.
- **The African layer**: per-mode system prompts (General, Study as a patient Nigerian teacher, Developer, Research), Nigerian context and examples, and replies in the user's language. The profile language wins; otherwise Naijá, Yorùbá, Hausa or Igbo is detected from the message.
- **Daily limits** per user and a lower one for guests, in MySQL (`CHAT_DAILY_LIMIT`, `CHAT_GUEST_DAILY_LIMIT`). Guests are counted per browser (an anonymous `colon_gid` cookie), plus a higher shared cap per hashed IP (`CHAT_GUEST_IP_DAILY_LIMIT`) because many mobile users sit behind one carrier IP; raw IPs are never stored. A reply that no provider could give is not counted.
- **Guest chat (ChatGPT-style)**: Colon AI works without an account. Guests chat with Saga through `POST /chat/guest` (streams, saves nothing; origin-checked, rate limited) and the conversation lives only in that tab. Guests can attach documents (read once by `POST /chat/guest/extract`, not stored); images need an account. The sidebar shows **Log in / Sign up** and "Log in to save your chats"; History, Saved and Settings ask guests to log in.
- **New sign-in flow** (`packages/ui/assets/colon-app.js`): **Continue with Google** on top, **OR**, email → **Continue** → password (log in) or name/password/language (sign up), with links to switch, forgot password and the 2FA step. It opens as a dialog in Colon AI (bottom sheet on phones) and is also the `/login` and `/register` page in every app. It reuses the Phase 2 endpoints and never asks the server whether an email exists.
- Migration `0003_chat` (runs automatically on API start like `0002`): `chat_conversations`, `chat_messages`, `chat_attachments`, `chat_feedback`, `chat_settings`, `chat_usage`.
- Unit tests for the router (language and mode routing, fallback order, timeouts, Stop, SSE parsing, `<think>` filtering) and chat helpers (limits, language detection, prompts, context budget, file checks, PDF/DOCX/XLSX/RTF extraction) with mocked `fetch`; `npm test` runs them with the UI tests. `services/api/test/e2e-smoke.js` and `test/helpers/mock-provider.js` run a full guest + account flow against MySQL/MariaDB with a fake provider.
### Changed
- **Colon AI no longer forces sign-in.** The chat app picks its data adapter on start: your account when signed in (Remote, the new default), a guest chat when signed out, and the on-device Preview only when the API can't be reached. Signing in or out reloads into the right mode. The Admin Dashboard still requires sign-in (and 2FA), and Colon Browser is unchanged.
- "Save chat history" off now makes signed-in chats temporary (streamed through `/chat/guest`, never saved).
- Version 0.4.0 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.3.1] — 2026-11-11 · Mobile fixes: scrolling, floating composer, stale-cache crash
Frontend only: no changes to `services/api`, `database`, `.cpanel.yml` or server configuration.
### Fixed
- **Scrolling on phones (Colon AI and Colon Browser).** Root cause: below 900 px both app shells stack vertically, and the flex column item between the fixed frame and the scroll area (`.cw-main` / `.bw-main`) had no `min-height:0`. It grew to the full height of its content, so the inner scroll areas (`#cw-scroll`, `.bw-page`, `.cb-viewport`) never overflowed, and the frame (`overflow:hidden`) clipped everything. Nothing could be scrolled by touch on any page. Desktop was unaffected because the shell is a row there. Fixed with `min-height:0` on `.cw-main`, `.cw-chat`, `.cw-split` and `.bw-main`. Verified with real touch drags (CDP touch events, 360×780, mobile emulation) on welcome, conversation, History, Saved, Explore, Settings, Help, the drawer list, and browser home, reader view, tabs, bookmarks, history, downloads, settings and help, plus mouse-wheel at 1440×900.
- **Colon Browser "C.keyboard is not a function".** Phones were running a stale cached `/ui/colon-app.js` from v0.2.0. Every CSS, JS and font reference in `apps/chat`, `apps/browser` and `apps/admin` `index.html` (and the `@font-face` URLs in `colon-ui.css`) now carries `?v=0.3.1`. Boot is defensive: optional kit helpers (`keyboard`, `resizable`, `verifyBanner`, `bindBanner`) are feature-checked before use, each app checks the kit (`Colon.version` plus the helpers it needs) before starting and shows a friendly **Please refresh** screen if an old kit loads, and a screen that fails to draw shows the same refresh card instead of a raw error. New `public/.htaccess` in each app sends `Cache-Control: no-cache` for `index.html` only. `scripts/check.js` now fails CI if any asset reference is not on the `package.json` version.
- Welcome subtitle is now exactly "Your ideas, questions and ambitions start here." (it was prefixed with the first word of the account name).
### Changed
- **Colon AI mobile footer removed.** The Home / History / Saved / Profile tab bar is gone, and those screens are in the hamburger drawer and sidebar. The shared account screens no longer show a tab bar in Colon AI or Colon Browser (`Colon.start({ tabbar: false })`). Colon Browser keeps its bottom navigation controls (back, forward, home, tabs, menu).
- **Floating composer.** The input is now a rounded pill that floats above the bottom edge, with side and bottom margins. It respects the safe area and sits above the on-screen keyboard (`visualViewport`, `100dvh` fallback). It has a soft shadow and blur, and the thread scrolls underneath it behind a fade. Attach, mode, mic and send are inside the pill. The mode is a compact button in the pill with a menu (General, Study, Developer, Research, Browse the Web). On the welcome screen the Study / Developer / Research chips scroll with the content and are horizontally scrollable without catching vertical swipes. Attach File / Voice Input / Browse the Web chips show on the desktop welcome screen only.
- **Scrolling behaviour.** There is one scroll container per view, and the page behind full-screen apps is locked (`html.app-lock`). Momentum scrolling is on, and `overscroll-behavior: contain` is set on the thread, drawer, conversation list, browser pages and tab strip. While a reply streams, the thread follows only if you are at the bottom. Scrolling up (touch, wheel or keys) stops the follow and shows a **Latest** button. Entry animations play only for new messages, and older messages use `content-visibility: auto` so long threads stay light.
- The "Preview" labels for the on-device data mode are unchanged, and they go away when the backend is connected.

## [0.3.0] — 2026-11-11 · Colon AI + Colon Browser interfaces (UI)
Frontend only: no changes to `services/api`, `database/migrations`, `.cpanel.yml` or server configuration.
### Added
- **Design system v2** (`packages/ui`): royal-blue tokens from the UI spec (#4169E1, #3457C7, #101B3D, #080F24, #EAF0FF, #38BDF8, #0F172A, #64748B, #E2E8F0, #16A34A, #DC2626), light and dark themes with no flash, self-hosted Inter and JetBrains Mono (OFL), new flame logo "COLON AI by Nifelux", glass surfaces, and shared components with every state (default, hover, active, focus, disabled, loading, error): buttons, inputs, switches, segmented controls, chips, popover menus with keyboard navigation, confirm and prompt dialogs, tooltips, drawers, toasts with actions, loaders, progress, skeletons, resizable split handles, 94 inline SVG icons. `visualViewport` tracking keeps inputs above the on-screen keyboard.
- **Colon AI** (`apps/chat`): welcome screen ("What can we explore today?", four prompt cards, Study / Developer / Research modes, input with attach and mic, Attach File / Voice Input / Browse the Web), chat workspace with collapsible sidebar (New Chat, search, Saved, Recent, History, Settings, Help, account), header (sidebar toggle, title rename, model selector, new chat, browser, theme, profile), token-by-token streaming with stop, Markdown, highlighted code with copy, tables, maths, citations and source cards, copy / regenerate / feedback with reasons / read aloud, auto-growing input, mode kept per conversation, model list from configuration, rename / pin / archive / delete with confirmation, uploads (images, PDF, documents, text) with previews, progress, validation and error states, voice input (live dictation or voice notes, with permission-denied, no-microphone and unsupported states), Settings (account, appearance, language, voice, chat preferences, privacy, data export and deletion, sign out), History, Saved, Explore and Help screens, and the integrated browser in embedded and split modes (resizable on desktop, switchable on mobile) sharing one browser session.
- **Colon Browser** (`apps/browser`): standalone app with sidebar (Home, Tabs with count, Bookmarks, History, Downloads, AI Browse, Settings, Help), address bar for URLs and searches with suggestions, back / forward / refresh / home / bookmark / download / full screen, tabs with a mobile tab overview, bookmarks with folders, date-grouped searchable history, downloads and uploads, settings (homepage, search engine, appearance, privacy, permissions, downloads, sessions, clear data), session restore, and visually distinct AI / Manual / Shared control modes with Take Control, Return to AI, Pause AI and Stop. Handoff pauses pending automation before the user takes over. The AI Browse panel shows the task, current site, progress, steps, an action log and sources; Shared mode asks for approval before each action.
- Honest **web reader preview** (docs/decisions/0002): pages are fetched as data, sanitised and rendered without scripts; private and local addresses are blocked by a unit-tested URL guard; sites that refuse cross-origin reads show an "open in new tab / Android app" state.
- **Data adapters** (`apps/chat/public/js/chat-data.js`, `packages/ui/assets/colon-browser-data.js`): every new screen works today on an in-browser implementation (IndexedDB, simulated streaming, on-device preview replies labelled "Preview") and switches to the API with `localStorage['colon.data'] = 'remote'`. Expected endpoints: `docs/frontend-data-adapters.md`.
- Unit tests (`node --test "packages/ui/test/*.test.js"`) for the Markdown renderer, URL/SSRF guard, preview responder and storage; CI runs them.
### Changed
- The animated intro and the Admin Dashboard pick up the new royal-blue brand through the shared design system. Account screens gain an Appearance (theme) control.

## [0.2.0] — 2026-11-11 · Phase 2: Accounts & security
### Added
- Accounts: register, sign in, Google sign-in (when `GOOGLE_CLIENT_ID` is set), email verification and password reset through Brevo (when `BREVO_API_KEY` is set).
- Sessions: httpOnly, Secure, SameSite=Lax cookie shared across Colon apps; device list, sign out one device or all others.
- Roles: Member, Moderator, Admin, Super Admin (`OWNER_EMAIL` becomes Super Admin). TOTP two-factor, required for every staff role.
- Security: scrypt password hashing, AES-256-GCM for 2FA secrets, MySQL-backed rate limits, lockout after 5 failed passwords, CSRF header + origin check, input validation, security headers, audit log.
- Profile with language preference (English, Naijá, Yorùbá, Hausa, Igbo), draft Terms and Privacy, account deletion.
- Admin: overview stats, users and roles, unlock, sign out a user, audit log.
- `packages/ui`: Colon design system and app core. Mobile-first: bottom tab bar, desktop sidebar, safe areas, bottom sheets, smooth route transitions.
- Database migrations now run automatically on API start (`0002_auth`).
### Changed
- Root `package.json` no longer uses npm workspaces, so cPanel installs API packages inside `services/api`.

## [0.1.0] — 2026-11-11
### Added
- Monorepo structure for Nifelux · Colon AI.
- `services/api`: Node 24 API with `/health` and the `/ws` WebSocket gateway.
- `apps/chat`, `apps/browser`, `apps/admin`: app shells with the animated COLON logo intro.
- cPanel Git deployment (`.cpanel.yml`), CI syntax check, and docs.
