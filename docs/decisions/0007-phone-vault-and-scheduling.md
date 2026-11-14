# ADR 0007: Saved logins live only on the phone; Saga runs in the background and on a schedule

**Status:** accepted (2026-11-14, v0.11.0). Builds on ADR 0005 (Saga browser automation) and ADR 0006 (the AI-only
card in the chat).

## Context

The owner asked for Saga to do more on its own: sign in to sites with logins it can reuse, keep working when the app
is in the background, run checks on a schedule ("check yolotask every morning"), replay saved routines, take
messages while it works, use several tabs and pull tables out of pages. Each of these widens what Saga can touch,
and two of them (logins and unattended runs) are where an assistant leaks secrets or acts without the user. The
backend runs on shared cPanel hosting (1 GB RAM, no push service) and the models are free hosted APIs we do not
control, so nothing secret may pass through either.

## Decision

1. **Colon Secured Login: a phone-only vault.** Site logins are typed only into a native Android form
   (`LoginFormActivity`, `FLAG_SECURE`: no screenshots or screen recording, not in Recents, no autofill to any
   page) and stored only in the phone's vault (`LoginVault`: AES-GCM with a key in the Android Keystore that never
   leaves it). There is no web form and no API to read a value: the chat page, the server, logs, analytics and every
   model prompt see at most `{site, login_saved: true|false}`.
2. **The phone fills, never the model.** Saga's tool is `signIn {site}`. The server sends `sign_in {site}` (any
   other argument is dropped by `tools.toCommand`); the phone fills the page itself through `assets/saga/login.js`
   only when (a) the page is **https**, (b) its host is the saved site or a subdomain of it (`VaultRules`), and
   (c) the user approved this site once ("Saga may sign in on <site>"), asked again if declined. The ack carries
   `submitted` or an error code (`no_login`, `not_trusted`, `wrong_site`, `approval_denied`, `no_form`) and never a
   value; the server discards anything else a phone sends back. `not_trusted` and `wrong_site` come with a hint for
   the model (don't retry / open the site's own sign-in page first); `no_login` hands the browser to the user with
   the Colon Secured Login form.
3. **Passwords stay out of the chat.** The composer holds back a message that looks like a password (a stated
   password or a lone password-like word, `lib/secret-text.js`) and offers the secure card; "save my github login"
   opens it directly. On the plain web the card explains that logins are saved only in the Android app and links
   to the APK. Typed values that look secret are shown as `•••• (n characters)` in the step timeline, and the
   timeline's pictures stay on the phone.
4. **Approval before consequences.** Submitting a form, paying, deleting and sending wait for the user's yes on the
   phone (a notification when the app is in the background); a denial is reported to Saga as "do not try another
   way".
5. **Background runs.** While a task runs, `SagaService` (a `dataSync` foreground service with an ongoing
   notification) keeps the process and its WebView alive; the user is notified when the task is done or needs them.
6. **Scheduled browsing and routines.** The server stores schedules and routines (migration 0011; at most
   `SAGA_SCHEDULES_MAX` per user) and, at the time, asks the user's connected phone to run the check in that chat's
   browser; results come back to the chat with what is new since the last run. A routine is the recorded steps of a
   finished task, replayed with re-planning when a page changed; risky steps still ask.

## Consequences and limits

- **Background stops if Android kills the app.** There is no FCM push yet: a battery saver that kills Colon AI ends
  the run (the next start reports it), and a schedule whose time comes while the phone is not connected runs when
  Colon AI next connects, marked as late.
- **Schedules need the app connected** (signed in, the bridge linked). Nothing runs on the server's own browser.
- **The vault fills only through page JavaScript on https trusted sites** after the one-time approval; sites that
  block scripted sign-in (some banks) still need the user (Take control or a Custom Tab).
- **Thumbnails are phone-only**; the server's action log keeps the step labels without values.
- Losing the phone, clearing app data or changing the device lock can make the vault unreadable: logins must be
  saved again. That is the price of never having a copy anywhere else.
- Multi-tab is capped at 6 tabs per task to fit low-RAM phones.
