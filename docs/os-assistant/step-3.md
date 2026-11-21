# Colon OS Assistant · Step 3: Colon Music (0.19.0; video cards in the chat since 0.22.0, one per request 0.22.1)

Colon AI on Android plays music and names songs, with free tools only. Plan: `plan.md` (Step 3, and Step 4's mic
recognition, which shipped early).

## What the user says
- **"play Last Last by Burna Boy"**: the phone's own songs first (MediaStore; Android asks for the music permission
  once), best match plays with the other matches queued. No match (or on the web): Colon finds it on **YouTube** and
  plays it in its own video card in the chat (0.22.0; above the composer in 0.21.x). When that can't, the card stays
  with the reason and an Open in YouTube button.
- **"watch Davido live"** (0.22.0): any YouTube video, not only music, in the card. Never the phone's songs.
  0.22.1, natural speech, typed or spoken, case and punctuation ignored, filler ("um", "please", "for me") dropped:
  "let's watch X", "I want/wanna watch X", "can I watch X", "can you show me X", "show me the video of X",
  "show me X video", "put on X", "play the video of X", "play X video", "open/find X on YouTube", "I'd like to watch
  X", "let me watch X", "search YouTube for X". Music: "play X", "let's play X", "I want to listen to X", "put on X
  song", "can you play X". Chat stays chat: "watch out", "what should I watch", "watch your words", "I watched X
  yesterday". All in one matcher, `apps/chat/src/lib/command-phrases.js` (table tests:
  `packages/ui/test/command-phrases.test.js`); the Android app runs the same chat page, so typed, voice-mode and
  overlay commands share it.
- While the card is open: **"pause"**, **"resume"**, **"forward"** / "skip ahead" / "fast forward" (+10 s),
  **"back"** / "rewind" / "go back" (−5 s), **"stop the music"**. There is no "next" any more.
- **"play Calm Down on YouTube" / "on Audiomack"**: opens it there directly. **"from my phone"**: phone only.
- **"play my music" / "shuffle my songs"**: the whole library, shuffled.
- **"what song is this?"** (also "what's playing", "shazam this", "who sings this"): Colon's video card first (its
  title and channel, 0.22.0), then Colon's own player (its tags; an untagged file is fingerprinted from the file
  itself, no mic). Only when both are idle does it listen with the mic for about 11 seconds (Step 4, `step-4.md`).
- **"play it"** / "play that song" within 10 minutes of Colon naming a song plays it in the card (0.22.0).
- Step 2 still owns "play music", "pause", "next song", "previous song" (media keys, which now reach Colon's player
  through its media session too).

## How it works
- **Player** (`ColonMusic.kt`, `MusicService.kt`): Media3 ExoPlayer in a `MediaSessionService` (foreground type
  `mediaPlayback`): notification, lock screen and headset controls; keeps playing with Colon closed.
- **Library** (`MusicLibrary.kt`) and matching (`MusicRules.kt`, unit-tested): every word said must be in the title,
  artist or album; the whole title or artist scores higher.
- **Allowlist** (`MusicRules.check`): bridge command `music` {action: play · play_url · open · stop · now ·
  identify}. `play_url` streams only from `https://*.jamendo.com` (unused since 0.21.0); open only YouTube or Audiomack search pages.
- **YouTube** (0.21.0, replaces Jamendo; `services/api/src/modules/music`, `GET /music/search?q=`, signed in,
  60/hour): YouTube Data API v3 search (embeddable music videos, region NG, cached 6 h), needs `YOUTUBE_API_KEY`.
  `kind=video` (0.22.0, "watch X") drops the Music category; the cache key includes the kind.
  The chat plays the result in `components/music-dock.js` (official IFrame player; pauses in the background per
  YouTube's rules).
- **Video cards** (0.22.1, like Saga's browser card): every watch or play request adds a NEW card under its own
  reply and never replaces an older one. One plays at a time: a new card stops the one before, which collapses to a
  row (thumbnail, title, **Play again**, Open in YouTube; `components/video-row.js`). The reply is saved with origin
  `video` and the video as its one source, so a reload shows past cards collapsed.
- **Commands in the thread** (0.22.1): every command (phone actions, music, watch, the card's player words, song
  recognition), typed or spoken, is saved as the user's message plus a short, varied reply
  (`lib/command-replies.js`, 2–3 wordings each; failures have their own, e.g. "I couldn't find WhatsApp on this
  phone."), via `POST /conversations/:id/notes` origin `command` (`actions/command-thread.js`). Voice mode speaks the
  same words (the phone's TTS in the app).
- **Video card** (0.22.0): the card sits in the chat thread under its reply (0.22.0: the message that was last).
  `message.js` redraws `#cw-page` on every render and moving an iframe restarts its video, so the card lives in a
  stable layer after `#cw-page` (`.cm-layer`) and `components/music-place.js` lays it over a placeholder
  (`.cm-slot`) that goes back into the thread after each render (`CW.placeMusic`, plus a ResizeObserver). A new
  chat, another chat or a page closes it. The video can't be tapped: `controls:0`, `disablekb:1`, `fs:0`,
  `iv_load_policy:3`, `rel:0`, pointer-events off and a clear shield (YouTube's branding stays visible; the player
  stays at least 200x200). Colon's row: Back 5 s, Play/Pause (follows the player), Forward 10 s, a progress bar with
  elapsed/total time, Open in YouTube, Close. A video whose owner blocks embedding silently falls back to the next
  search result; there is no Next button.
- **Song ID** (`SongId.kt`): [songprint](https://github.com/hitenpatel/songprint) (MIT, vendored under
  `io/github/hitenpatel/songprint`) builds a Shazam-compatible signature on the phone from 16 kHz mono audio; only
  the signature (a few KB, never the audio) is sent to Shazam's public discovery endpoint, which answers with the
  title and artist. No key, free. That endpoint is **unofficial and undocumented**: it may change or stop, so it is
  only a fallback and fails with "I couldn't recognise that song".
- Web: `apps/chat/src/lib/music-intent.js` (parser, tested), `apps/chat/src/actions/music-chat.js` (phone →
  Colon's YouTube player → YouTube app), routed in `send-message.js` before Step 2.

## Changes from the plan
- **Chromaprint + AcoustID** for untagged files was replaced by songprint on the file's own audio: Chromaprint is
  native C (an NDK build) and AcoustID needs its own key and is non-commercial; songprint is pure Kotlin and needs no
  key. Revisit if the Shazam endpoint goes away.
- **AudD** (300 free requests) for the mic was replaced by songprint.
- MySQL `music_*` tables and Cover Art Archive artwork are not needed yet (nothing is cached server-side).

## Turn it on
- Admin: set `YOUTUBE_API_KEY` in the API env and restart the Node app.
- User: Android asks for music access the first time they say "play …", and the mic for "what song is this?".

## Test checklist (Infinix SMART 20 first)
- [ ] "play <song on the phone>": permission prompt once, then it plays; notification with controls
- [ ] Lock the phone / leave Colon: music keeps playing; headset button pauses
- [ ] "next song", "pause" (Step 2) control Colon's player
- [ ] "play <song not on the phone>": the video card plays it in the chat thread; Play/Pause, −5s, +10s, the
  progress bar; "pause", "forward", "back", "stop the music"; tapping the video does nothing
- [ ] Send a chat message while the card plays: the video keeps playing (no reload) and stays in its place
- [ ] New chat / open another chat: the card closes
- [ ] "watch <any video>": a non-music video plays in the card
- [ ] Leave Colon: the YouTube card pauses (YouTube's rule)
- [ ] "play X on Audiomack": Audiomack search opens
- [ ] "what song is this?" while Colon plays a tagged song: answers at once, no mic
- [ ] Same with an untagged file (e.g. WhatsApp audio named AUD-…): answers from the file
- [ ] Colon idle, music from a speaker: "Listening…", then the title
- [ ] Hands-free: answers are spoken; music that starts ends hands-free
- [ ] 0.22.1: "watch A", then "watch B": two cards; A collapses to a row (thumbnail, title, Play again, YouTube)
  and stops; Play again on A plays it in its own place and collapses B; reload: both collapsed
- [ ] 0.22.1: "take me to WhatsApp" (typed and spoken): the thread shows it and "I'll take you to WhatsApp now.";
  a reload keeps both; "open nosuchapp app": "I couldn't find Nosuchapp on this phone."
- [ ] 0.22.1: voice mode over WhatsApp (Talk to Colon shortcut): the wave is flat in silence and moves when you
  talk; your words show live; "what's the capital of Ghana" is answered aloud and saved in the chat; silence gives
  "I didn't catch that"; with the mic permission revoked, the overlay says so (`adb logcat -s ColonVoice`)
- [ ] Colon Browser flavor unchanged
