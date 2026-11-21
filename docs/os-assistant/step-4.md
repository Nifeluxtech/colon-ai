# Colon OS Assistant · Step 4: Recognise music around you (0.22.0)

Colon AI names a song playing near the phone, with free tools only. Plan: `plan.md` (Step 4). Free-only by owner
decision 2026-11-21: no paid providers (no ShazamKit, which needs a $99/yr Apple Developer account, and no paid
AudD tier); no paid provider code or config.

## What the user says
- **"what song is this?"** (also "what's playing", "shazam this", "who sings this"):
  1. Colon's video card in the chat, when it is playing: its title and channel, no mic.
  2. Colon's own music player (Step 3): its tags, or a fingerprint of an untagged file, no mic.
  3. Only when both are idle: the mic listens for about 11 seconds and the providers below run in order.
- **"play it"** / "play that" / "play that song" within about 10 minutes of a song being named plays it in the video
  card (YouTube search for its title and artist).

## Providers (`SongRecognizer.kt`)
1. **songprint** (built in, MIT, vendored): builds a Shazam-compatible signature on the phone from 16 kHz mono audio
   and sends only that signature to Shazam's public discovery endpoint (unofficial; see `step-3.md`).
2. **Shazam app hand-off**: when songprint finds no match or there is no network, and the Shazam app
   (`com.shazam.android`) is installed, Colon opens it to listen (intent action
   `com.shazam.android.intent.actions.START_TAGGING` for that package, else its launcher). The page gets code
   `handed_off` and Colon says "Opening Shazam to listen." The answer then shows in Shazam, so Colon can't remember it
   for "play it". The manifest declares the package in `<queries>` so Android 11+ lets Colon see it.
3. Neither: "I couldn't recognise that song" (`no_match`), as before.

`SongRecognizer.Provider` is the adapter: another free on-phone recogniser can be added to its list later.

## Privacy
- The microphone is used only when asked, only while nothing plays in Colon, for about 11 seconds.
- The audio never leaves the phone: only the songprint signature (a few KB) is sent. A hand-off gives the job to the
  Shazam app, under the user's own Shazam settings.
- Nothing is stored on Colon's server; the last named song is kept in the page's memory only, for "play it".

## Test checklist (Infinix SMART 20 first)
- [ ] Video card playing: "what song is this?" answers from the card, no mic prompt; then "play it" resumes it
- [ ] Colon idle, music from a speaker: "Listening…", then the title; "play it" plays it in the video card
- [ ] Airplane mode with Shazam installed: "Opening Shazam to listen.", Shazam starts listening
- [ ] Airplane mode without Shazam: "I couldn't recognise that song."
