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
