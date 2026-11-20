# Step 1 · Colon as the phone's assistant

Plan: `docs/os-assistant/plan.md`. The blueprint's Step 1 (Kotlin shell, WebView bridge, mic → text → Saga → spoken
reply) already exists in `apps/android` and the chat: `MainActivity`/`ShellWeb`, `window.ColonNative`
(`docs/android-bridge.md`), voice input `POST /voice/transcribe`, read-aloud `POST /voice/speak` and hands-free mode
(`apps/chat/src/lib/hands-free.js`, Phase 6). So Step 1 adds only the missing entry point: opening Colon from
anywhere on the phone, straight into a voice conversation. All free: no new library, no new service.

## How it works
1. `AssistActivity` (Colon AI flavor only) handles `android.intent.action.ASSIST` (long-press Home / corner swipe,
   once Colon AI is the default digital assistant app) and `android.intent.action.VOICE_COMMAND` (headset or car
   voice button). It forwards to `MainActivity` with `EXTRA_ASSIST` and finishes.
2. `MainActivity` keeps `pendingAssist` and emits the bridge event `assist`.
3. Bridge: new command `takeAssist` (true once), new feature `assist`, `ColonNative.takeAssist()`.
4. Chat (`apps/chat/src/lib/native-shell.js`): when the app has feature `assist`, it calls `takeAssist` on load and on
   each `assist` event and starts hands-free (`S.hf.start()`) if not already on. Older apps never ask.

Speech, languages (Nigerian English, Pidgin, Yorùbá, Hausa, Igbo), Saga and voices are exactly the chat's.

## Turn it on (user)
Settings › Apps › Default apps › Digital assistant app › **Colon AI** (Infinix XOS: Settings › Apps › Default apps ›
Assist & voice input). Then long-press Home.

### When the phone keeps its gestures (0.18.2)
Gesture navigation has no Home button, and some phones keep the corner swipe and power-key hold for their own
assistant (Infinix XOS: Folax). Two Colon-owned ways in, both hands-free (`AssistTile.kt`):
- **Quick Settings tile** "Talk to Colon": pull down the shade › edit (pencil) › drag the tile in › tap it.
- **Launcher shortcut** "Talk to Colon": long-press the Colon AI icon; drag it to the home screen for a one-tap icon.

## Test checklist (Infinix SMART 20 first)
- [ ] Colon AI appears in the digital assistant list; choosing it works
- [ ] Long-press Home with the app closed: chat opens and hands-free starts listening
- [ ] Same with the app open on a chat, and in the background
- [ ] First time: microphone permission prompt, then listening
- [ ] Rotate while listening: hands-free does not start twice
- [ ] Signed out / guest: no crash, sign-in page shows
- [ ] Quick Settings tile opens hands-free (unlocked and from the lock screen)
- [ ] Long-press icon › Talk to Colon opens hands-free; pinned home-screen copy too
- [ ] Colon Browser flavor unchanged (no assist entry)
- [ ] CI: unit tests + lint pass for both flavors

## Next (Step 2)
Phone control: intent router for "open WhatsApp", "call …", volume, settings, validated against an allowlist.
