# Colon OS Assistant · Step 3: Colon Music (0.19.0)

Colon AI on Android plays music and names songs, with free tools only. Plan: `plan.md` (Step 3, and Step 4's mic
recognition, which shipped early).

## What the user says
- **"play Last Last by Burna Boy"**: the phone's own songs first (MediaStore; Android asks for the music permission
  once), best match plays with the other matches queued. No match (or on the web): Colon finds it on **YouTube** and
  plays it in its own player above the composer (0.21.0). When that can't, the song opens in the YouTube app.
- **"play Calm Down on YouTube" / "on Audiomack"**: opens it there directly. **"from my phone"**: phone only.
- **"play my music" / "shuffle my songs"**: the whole library, shuffled.
- **"what song is this?"** (also "what's playing", "shazam this", "who sings this"): Colon's own player first (its
  tags; an untagged file is fingerprinted from the file itself, no mic). Only when Colon's player is idle does it
  listen with the mic for about 11 seconds.
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
  The chat plays the result in `components/music-dock.js` (official IFrame player above the composer; pauses in the
  background per YouTube's rules). Without the key, or when nothing embeds, the YouTube app opens.
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
- [ ] "play <song not on the phone>": the YouTube card plays it in the chat; "pause", "next", "stop the music"
- [ ] Leave Colon: the YouTube card pauses (YouTube's rule)
- [ ] "play X on Audiomack": Audiomack search opens
- [ ] "what song is this?" while Colon plays a tagged song: answers at once, no mic
- [ ] Same with an untagged file (e.g. WhatsApp audio named AUD-…): answers from the file
- [ ] Colon idle, music from a speaker: "Listening…", then the title
- [ ] Hands-free: answers are spoken; music that starts ends hands-free
- [ ] Colon Browser flavor unchanged
