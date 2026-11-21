# Colon OS Assistant · Step 5: "Hey Colon" + release (0.23.0)

Say **"Hey Colon"** and Colon opens its voice listener, from any screen and with the screen locked, with free tools
only (owner decision 2026-11-21). Plan: `plan.md` (Step 5). Off by default.

## How it works
- **Switch**: Settings › Voice › **Hey Colon** (Android app only; `components/wake-word-settings.js`, bridge feature
  `wake_word`, `WakeWord.kt`). Kept on the phone, not in the account. Turning it on asks for the microphone (and,
  on Android 13+, notifications). **Pause on battery saver** is on by default.
- **Service** (`WakeWordService.kt`): a foreground service of type `microphone` with a persistent notification
  ("Hey Colon is on · Say "Hey Colon" to talk", or why it is paused) and a **Stop** action that turns the switch
  off. Android 14+ only lets a microphone service start while Colon is on screen, so it starts from the app
  (switching it on, or opening Colon after a reboot), never at boot.
- **Engine** (`WakeWordEngine` interface, `src/wake-sherpa/.../WakeEngines.kt`): sherpa-onnx keyword spotting
  v2.0.2 (Apache-2.0, offline), model `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-mobile` (int8 encoder
  and joiner, about 5 MB), keywords file `assets/kws/keywords.txt` = `▁HE Y ▁COL ON` (no training). 16 kHz mono
  PCM in 100 ms chunks from `AudioSource.VOICE_RECOGNITION`; one thread; a 3 s cooldown (`WakeWordDetector`).
- **Backup engine: openWakeWord** (Apache-2.0 code). Train a "hey colon" model with its free Colab notebook (synthetic
  speech, about an hour), run the melspectrogram, embedding and model ONNX files with ONNX Runtime Android, and wrap
  it as another `WakeWordEngine`; the service, rules and settings stay the same. Note: the pre-trained openWakeWord
  models are CC BY-NC-SA (non-commercial); a model we train ourselves is ours.
- **On detection**: a chime (`VoiceCues.chime`), the mic is closed, then the voice listener opens exactly like the
  "Talk to Colon" shortcut (`AssistShortcut.assistIntent`, compact), so the command or chat goes through the chat
  page and both lines show in the thread. From the background Android only allows this with "Display over other
  apps" (already asked for voice mode's pill); without it a high-priority "Hey Colon · Tap to talk" notification
  appears instead.
- **Pauses** (`WakeWordRules`, unit tested): no mic permission; engine failed to load; a call (AudioManager mode
  ringtone / in call / in communication); Colon's own recognizer, voice mode or song ID (`NativeListen.inUse`,
  `VoiceMode.active`, `ColonMic`; the recognizer takes the mic at once via `WakeWordService.yieldMic()`); 8 s after a
  detection; another app recording (`AudioManager.activeRecordingConfigurations`) or the mic failing to open
  (retried after 5 s); battery saver when that option is on. It re-checks every 3 s while listening and 1.5 s while
  paused, and resumes by itself.

## Build
CI (`.github/workflows/android.yml`, step "Wake word engine and model") downloads, sha256-checks and places:

| File | URL | sha256 |
|---|---|---|
| `app/libs/sherpa-onnx-static-link-onnxruntime-2.0.2.aar` | `https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.2/sherpa-onnx-static-link-onnxruntime-2.0.2.aar` | `cb73564809268c8b96bf98f1a32b0b3b611e01d028d22f10beb57ef55418c0cb` |
| model archive (4 files copied to `app/src/colonai/assets/kws/`) | `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-mobile.tar.bz2` | `2e6ac2577310bfa2f4b6b5fab0478b868c9d0b2cb2c51b3e13b50581b588864d` |

The static-link AAR is used (onnxruntime linked into `libsherpa-onnx-jni.so`: one library, smaller APK than the
shared AAR, sha256 `6420cfb8…a80e`). Colon AI packages only `arm64-v8a` and `armeabi-v7a`. Nothing downloaded is
committed (`apps/android/.gitignore`). A local build without these files builds Colon AI with no wake word
(`src/wake-none`, the switch is hidden). R8 keeps `com.k2fsa.sherpa.onnx.**` (JNI reads fields by name).

## Privacy
- Off until the user turns it on; a notification is always visible while it can listen; Stop is one tap.
- Audio stays on the phone: the spotter runs offline and keeps nothing. Only after "Hey Colon" does the normal voice
  listener run (the phone's speech recognizer, as before).

## TODO: Crash monitoring (Firebase Crashlytics)
Skipped in 0.23.0: Crashlytics needs `google-services.json` in the app (the build plugin reads it), which would be a
committed project config. To add it without committing it:
1. Firebase console › new project "Colon" (free Spark plan) › add Android apps `ng.nifelux.colonai` and
   `ng.nifelux.colonai.debug`; download `google-services.json`.
2. Save it base64-encoded as the repository secret `ANDROID_GOOGLE_SERVICES_JSON`; in `android.yml` write it to
   `apps/android/app/google-services.json` before the build (like the keystore) and gitignore it.
3. Add the plugins `com.google.gms.google-services` and `com.google.firebase.crashlytics` and the dependency
   `firebase-crashlytics` (BoM) to the colonai flavor, applied only when the file exists (like `hasKws`).
4. Log a non-fatal for wake word engine load failures and `ColonVoice` recognizer errors; test with a forced crash
   in a debug build; check the dashboard; then mark checklist item 15.

## Release checklist (blueprint, 15 items)
Run on a release-signed APK. ☐ = not yet checked on a device.

| # | Item | How to check | Status |
|---|---|---|---|
| 1 | Manual voice activation works | Mic button, tile, shortcut, long-press Home: Colon listens and answers | ☐ |
| 2 | Hey Colon detects the custom wake phrase | Switch on; say "Hey Colon" 10× at 1 m, 10× at 3 m; count hits | ☐ |
| 3 | Background listening has a visible notification | "Hey Colon is on" shows whenever the service runs | ☐ |
| 4 | Users can disable microphone listening | Switch off, and notification Stop: notification gone, mic dot off | ☐ |
| 5 | Colon answers through its AI backend | Voice chat question gets a spoken answer (first audio < 2 s) | ☐ |
| 6 | Colon opens supported installed applications | "open WhatsApp" by voice after "Hey Colon" | ☐ |
| 7 | Colon Music plays authorized audio files | "play <song on phone>" | ☐ |
| 8 | Music continues when the screen is locked | Lock during playback for 5 min | ☐ |
| 9 | Media controls work from notification and lock screen | Pause, next, previous from both | ☐ |
| 10 | Song recognition returns metadata on a match (free path; ShazamKit dropped, Step 4) | "what song is this?" near a speaker | ☐ |
| 11 | Music recognition handles failed matches | Silence or noise: "I couldn't recognise that song" | ☐ |
| 12 | Voice commands can control Colon Music | "pause", "next song", "stop the music" | ☐ |
| 13 | JavaScript bridge rejects unauthorized commands | Unit tests (`BrowserPhase8Test`, `PhoneRulesTest`) + an off-origin page can't call ColonNative | ☐ |
| 14 | Authentication and API security tests pass | `npm test` (services/api/tests/security) green | ☐ |
| 15 | Battery usage and crash monitoring are acceptable | Hey Colon on for 8 h idle: battery use in Settings › Battery; Crashlytics TODO above | ☐ |

## Device test matrix
Phones: **Infinix** (SMART 20, Android 16, XOS), **Tecno** (HiOS, Android 13–15), **Samsung** (One UI, Android 14+).
Each cell: say "Hey Colon, what time is it?" and note hit / miss / false trigger, and the time to the voice screen.

| Condition | Infinix | Tecno | Samsung | What to expect |
|---|---|---|---|---|
| Unlocked, Colon open | ☐ | ☐ | ☐ | Chime, voice screen, answer |
| Unlocked, another app open | ☐ | ☐ | ☐ | Chime, pill/overlay (with "Display over other apps"), else "Tap to talk" notification |
| Screen locked | ☐ | ☐ | ☐ | Chime; the voice screen may wait for unlock (lock screen activity rules); note behaviour |
| Battery saver on (option on / off) | ☐ | ☐ | ☐ | On: notification "Paused: battery saver is on", no hits; off: works |
| Bluetooth headset connected | ☐ | ☐ | ☐ | The phone's mic is used (no SCO); note if the headset mic is needed |
| During a call | ☐ | ☐ | ☐ | "Paused during the call", resumes after |
| Reboot | ☐ | ☐ | ☐ | Off until Colon is opened once (Android 14+ rule); then on by itself |
| Offline (airplane mode) | ☐ | ☐ | ☐ | Detection works offline; commands that need no server work; chat says it's offline |
| Another app recording (voice note) | ☐ | ☐ | ☐ | "Paused: another app is using the microphone", resumes after |
| OEM battery manager (XOS / HiOS "auto-start", Samsung "sleeping apps") | ☐ | ☐ | ☐ | Note if the service is killed; add the steps to allow Colon to the help text |
| 8 h idle with Hey Colon on | ☐ | ☐ | ☐ | Battery use per hour; false triggers counted |

## Unverified (needs a device)
Detection accuracy and false triggers with Nigerian accents; the keywords threshold (sherpa default 0.25, score 1.5);
whether `activeRecordingConfigurations` shows other apps on each OEM; OEM background killing; the chime volume;
opening the voice screen over the lock screen.
