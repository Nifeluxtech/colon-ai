# Colon OS Assistant: 5 Free Steps (agreed plan, Nov 20, 2026)
Source blueprint: docs/os-assistant/blueprint-original.md (ChatGPT "COLON OS ASSISTANT — Production Development Blueprint"). Rule: use the best FREE tools everywhere.

## Step 1: Native shell + manual voice (weeks 1–2)
- Kotlin + Android Studio, package com.nifelux.colon, wraps existing chat WebView
- AndroidX WebKit WebMessageListener bridge, locked to chat.apparatus.name.ng
- STT: Android SpeechRecognizer (offline option: sherpa-onnx ASR)
- AI: Saga backend (Gemma 4 free tier) via POST /api/v1/assistant/chat
- TTS: Android TextToSpeech
- Done: mic → text → Saga → spoken reply on Infinix

## Step 2: Phone control (week 3)
- Intents + PackageManager with narrow <queries>; AudioManager for volume; Settings intents
- Intent router: local rules + Saga structured JSON (OPEN_APP, PLAY_MUSIC, ...) validated against an allowlist
- Done: 10+ commands work, unknown actions rejected

## Step 3: Colon Music + built-in song ID (weeks 4–5)
- Media3 / ExoPlayer + MediaSessionService
- Sources: phone library (MediaStore) + Jamendo API (free CC music)
- Song ID with no mic: Jamendo metadata; local tags via Media3 MediaMetadata/MediaMetadataRetriever; untagged files → Chromaprint fingerprint → AcoustID → MusicBrainz (free non-commercial), cache in MySQL; artwork from Cover Art Archive
- "What song is this?" checks Colon's own player FIRST; mic only when player idle
- "Play X": search phone library, then Jamendo; mainstream tracks not found → open in YouTube/Audiomack via intent
- Metadata in music_* tables, existing MySQL on cPanel

Shipped in 0.19.0 (see `step-3.md`): songprint (MIT, Shazam-compatible signatures, free public endpoint) replaced
Chromaprint+AcoustID for untagged files and AudD for the mic; no MySQL tables yet.

## Step 4: Recognize music around you (week 6)
Free-only by owner decision 2026-11-21: no paid providers (ShazamKit's $99/yr Apple Developer account and AudD's
paid tier are dropped from the plan).
- MusicRecognitionProvider adapter (`SongRecognizer.kt`), free providers in order:
  1. songprint on the phone (Shazam-compatible signature; only the signature leaves the phone)
  2. Hand off to the Shazam app via intent when it is installed (free, the user's own app)
- "What song is this?" answers from Colon's own player or video card first; the mic only when nothing plays there

Status: shipped in 0.22.0 (see `step-4.md`, ADR `docs/decisions/0008-free-only-song-recognition.md`).

## Step 5: "Hey Colon" + release (weeks 7–9)
- Wake word: sherpa-onnx keyword spotting (Apache-2.0, offline, "HEY COLON" in keywords file, no training); backup openWakeWord. (Porcupine free tier ended Jun 30, 2026.)
- Opt-in microphone foreground service + persistent notification + Stop (Android 14+)
- Test: Infinix, Tecno, Samsung; locked, battery saver, Bluetooth, reboot, offline
- Firebase Crashlytics; pass blueprint's 15-item release checklist
