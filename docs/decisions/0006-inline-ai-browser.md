# ADR 0006: Saga's browser is an AI-only card in the chat, with Take control

**Status:** accepted (2026-11-14, v0.10.3). Supersedes the "AI + me" / Manual modes of Phase 10 for Colon AI's
in-chat browser (Colon Browser keeps its own modes).

## Context

Up to 0.10.2 the chat's browser was a panel the user could also drive: an address bar, tabs, layouts (inline,
embedded, split, full screen) and three control modes (Manual, AI only, AI + me). On the owner's phone this read as a
second app squeezed into the chat: the page competed with the thread for height, touches meant for the chat went
into the page, and it was never clear who was driving. The owner asked for a "Manus-style" design: the browser lives
in the thread like a card (Hark's own browser card is the reference: a rounded, landscape, live desktop page scaled
down, a floating status pill with the current step or the final result, an expand button), it is always Saga's, and
the user steps in only when Saga needs them or when they choose to.

## Decision

1. **One card per Saga task, in the thread.** The card sits under the chat message that started the task and
   scrolls with the thread (the chat page draws the box, the app lays its WebView over it: the 0.9.1–0.10.2
   geometry, clipped between the header and the composer). It is landscape (16:10 at the chat's width), capped so it
   fits above the composer with the keyboard closed. Only the newest task holds the live WebView; when a task ends
   the app keeps a small JPEG of the page (at most 6 pictures and 600 KB per chat, 20 cards) with the result, lets
   the WebView go, and the chat shows the picture; a tap brings the live browser back.
2. **Always the desktop site.** A desktop user agent, wide viewport and overview mode, and a document-start script
   that keeps the page's viewport at `width=1280` (less on very narrow phones: WebView zooms out at most 4×), so the
   card shows a desktop page scaled down like a screenshot. *Deviation from "a fixed WebView width":* we size the
   WebView to the card and fix the page's layout width instead of laying out a 1280 dp WebView and scaling the
   view. The page looks the same, but WebView rasterises only the pixels on screen (a scaled 1280 dp view costs
   tens of MB of tiles on a cheap phone), and full screen keeps working pinch zoom.
3. **AI-only, with one way in.** The page takes the user's touches, scrolls, keys and screen-reader actions only
   in `user_control`. The card's state machine (`ChatRun`, persisted per chat): running, paused, needs_user (Saga
   asked), user_control, done, error, stopped (and idle). Saga asks for the user with a new tool,
   `requestUserControl { reason, instructions }` (sign-in, code, captcha, payment, consent), and secret fields
   still hand over by themselves; the user can also take control at any time.
4. **Take control is full screen over the chat, not a new screen.** The same WebView grows (a short animation, no
   reload) to fill the screen above the chat's own composer, with a slim bar: title and host, back and reload,
   "Give back to Saga". The page resizes above the keyboard; the composer keeps working. Whatever the user sends
   from the composer is their hand-back: it goes to Saga as a note (their words with anything secret-looking
   hidden, and the page's host and path; never a field's value), the view collapses and Saga carries on. The expand
   button opens the same view read-only, with Take control.
5. **The server waits instead of ending.** Take control and Pause used to end the task (`interrupted`). Now the
   loop waits (`user_control` / `paused`, up to `SAGA_USER_CONTROL_TIMEOUT_MS`, 15 minutes) and folds the note into
   the next observation; Saga's own requests wait up to `SAGA_HANDOFF_TIMEOUT_MS` (10 minutes). Time spent waiting
   for the user does not count against the task's time limit. A wait that runs out stops the task cleanly: the
   phone is told (`control manual`, a `stopped` notice) and the card says so. The phone's Stop ends it at once.
6. **Consent is the user's own instruction.** A task started from the chat tells the app first, which counts as
   the user's yes for that chat (no "Let Saga browse?" dialog); a task the server starts any other way still asks.
7. **The web shows the same card, gracefully.** In a desktop browser the chat shows each of the conversation's
   tasks as the same card shape with its status or result and "Open in the Colon AI app for the live browser".
   *Deviation:* the server keeps no picture of the page (page pixels can hold private data and the server stores no
   page content by design), so web cards have no snapshot.

## Consequences

- One live WebView at a time per chat (one tab live on low-RAM phones), released when the task ends: less memory
  than the 0.10.x panel, at the cost of a reload when a finished card is reopened.
- A dropped socket still ends the server's task (`disconnected`); the card shows the error with Retry, which runs
  the same goal again under the same message. Resuming the same task on a new socket (possibly on another worker)
  is left for when there is push (FCM) to wake the phone.
- An app killed mid-task can't follow the server's task afterwards: on the next start the card shows "Saga stopped
  when the app closed" with Retry.
- Older chat pages (0.10.2) with a 0.10.3 app still work: the app draws the pill and buttons over the old card's
  body. Older apps with a 0.10.3 page are told "AI only" for every chat.
- The model must learn one more tool; free models that ignore it still fall back to the secret-field hand-off.

## Addendum (0.10.4): continue and reconnect

Owner's report on 0.10.3 (Infinix SMART 20, Developer chat): after "Login" Saga asked them to sign in, but the card
went blank with "Saga stopped" and Retry; after they logged in Saga never caught up; "reshow the browser" went to the
model, which said it couldn't; and Saga's pointer could hardly be seen. The admin replay showed the task stuck in
`handoff` with no end row (its worker was gone while it waited), and the code showed three ways a wait for the user
died: a dropped socket ended the task at once (`disconnected`), a new socket refused the user's Give back
(`needs_consent`: consent lived on the old socket), and an app that was closed or rebuilt mid-task lost its
control state, so Give back was refused on the phone and the card ended as "stopped".

Decisions:

1. **A task outlives its socket and its worker.** Saga talks to the phone through a link
   (`modules/saga/link.js`). When the socket drops, the task lets go of its row and waits up to
   `SAGA_RECONNECT_GRACE_MS` (90 s) for the same user's Colon AI app; on this worker the new socket takes over (a
   handoff is sent again, a Give back made on it meanwhile counts); if the phone came back on another worker, that
   worker adopts the task from its sweep (`resume.js`) and goes on from the saved log. Workers stamp the tasks they
   run every 12 s; a task whose stamps stopped for 40 s (a recycled worker) is adopted the same way. A read in
   flight when the socket dropped is sent again; an action is reported to Saga as "may or may not have happened,
   look first" (never repeated by the server). Nobody back within the grace: `interrupted` / `disconnected`.
2. **Consent follows the phone, not the socket.** Hello carries `resumable` (the AI mode a waiting task returns to);
   the server keeps consent for that socket, so Give back works after a reconnect. The phone re-sends its latest
   control report on the next socket when the first couldn't take it (or died right after).
3. **The phone never gives a waiting task up.** After the app was closed, a task the server knows waits for the
   user (Saga's request stays; a task Saga was running becomes "The app closed while Saga worked. Give back to carry
   on"); the control state is restored from the saved run, and Give back always resumes (a lost state is put back
   first). The chat page follows a live task again after a reload.
4. **Continue.** An ended card whose page is still there says Continue: the live browser comes back on its page and
   a task starts with `continue_of`: the server folds the earlier task's steps and ending into Saga's first prompt
   (a `continue` row, no migration) and stops the earlier task if it was still live. "Reshow / show / reopen the
   browser", "where is the browser" and "continue" / "I've logged in, continue" are handled in the chat
   (`browser-intent.js`) and never reach the model, and the model's system prompt says it can open the in-chat
   browser.
5. **Watchable.** The pointer sits above the card's controls, 1.5× at card scale with a halo, and stays on the page
   while Saga has it (it fades when the task ends or the user takes control); it outlines the element it clicks or
   types into, and Saga types text out a piece at a time (act.js `type`, then the exact fill). The card keeps a
   picture after every finished step and shows it while the page (re)loads, and a picture of a page that hadn't
   painted (one colour) is never kept.

Consequences: switching chats still ends the task in the chat left behind (the panel shows one chat's browser);
its card then offers Continue. Push (FCM) to wake a phone that is fully offline is still not built.

