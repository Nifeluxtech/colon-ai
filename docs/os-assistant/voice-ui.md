# Voice mode redesign (0.20.0)

What the user asked for: "in the app it should be like GPT voice mode style, when in background it should be like
dynamic (island), on tap should fill round corner the full screen like Siri with the voice wake animation by the
footer".

Voice mode is the existing hands-free conversation (Phase 6: listen → send when you stop talking → read the reply
aloud → listen again). 0.20.0 changes how it looks, in the app and over other apps. The conversation loop itself
(`apps/chat/src/lib/hands-free.js`) is unchanged apart from a new **Mute** and hooks for the screens below.

## 1. In the app: full-screen voice screen (web, all platforms)

Starts whenever hands-free starts: the empty composer's **Voice mode** button, the mic menu's "Hands-free
conversation", or the phone's assistant / Quick Settings tile / "Talk to Colon" shortcut in the Android app.

| Part | Behaviour |
|---|---|
| Backdrop | Dark navy, blurred (`backdrop-filter`), always dark in both themes |
| Orb | Large, centred. **Listening**: breathes, a ring pulses outward, and it grows with the mic level (Colon speech recorder; dictation has no level, so it just breathes). **Thinking**: violet, slow swirl. **Speaking**: blue/pink, talking pulse. **Muted**: grey, still |
| Label | "Listening…", "Thinking…", "Speaking", "Mic muted" (`aria-live`) |
| Caption | What was heard (newest words, while listening and thinking), then the start of the reply (while speaking); 3 lines max |
| Footer | **Mute** (mic off / on, `aria-pressed`) and **End** (red X). Esc also ends |
| Top-left | **Show chat** hides the screen; tapping the hands-free pill above the composer brings it back |
| Reduced motion | `prefers-reduced-motion: reduce`: no animation and no level scaling |

Code:

- `apps/chat/src/lib/voice-orb.js`: pure state machine (`reduce(model, event)`, labels, captions, orb scale,
  the pill payload). Unit-tested in `packages/ui/test/voice-orb.test.js`.
- `apps/chat/src/lib/voice-overlay.js`: the DOM, focus, Esc, and the Android bridge.
- `apps/chat/public/assets/css/chat-voice.css`: styles (next to `chat-composer.css`).
- `hands-free.js`: `ui` option (phase, heard, say, level) and `mute(on)` / `muted()`. Mute cancels the current
  turn without ending the session; muting while Colon thinks or speaks takes effect at the next turn.

## 2. Android: "dynamic island" pill and Siri-style expanded overlay (Colon AI app only)

### Bridge

Feature `voice_ui`. The page calls `ColonNative.call('voice_ui', {state, caption, muted})` on every state change
(captions at most every 400 ms; mic level is never sent). `state` is `idle | listening | thinking | speaking |
muted`; captions are cut to 140 characters (`VoiceUiRules.parse`). The app answers `{pill: true|false}` (whether
"Display over other apps" is on). The pill's and notification's End / Mute / Unmute come back to the page as the
event `voice_action` `{action: end|mute|unmute}`.

### Pieces

| File | Role |
|---|---|
| `VoiceUiRules.kt` | Pure rules: message check, label and colour per state, pill vs. prompt vs. notification, step-back, corner radius, gestures. `VoiceUiRulesTest` |
| `VoiceMode.kt` | App-side state, starts / stops `VoiceService`, one-time permission prompt, compact start, actions back to the page |
| `VoiceService.kt` | Foreground service, type **microphone**: keeps the mic usable in the background, ongoing "Colon voice mode" notification (Mute, End, tap = open), owns the overlay |
| `VoiceOverlay.kt` | The two overlay windows (`TYPE_APPLICATION_OVERLAY`) and pill gestures |
| `VoiceOverlayViews.kt` | `VoiceWaveView` (bars) and `EdgeGlowView` (glowing rounded screen edge) |

Why a new service rather than `SagaService`: Saga's service is type `dataSync`, which does not let a backgrounded
app use the microphone (Android 11+ "while-in-use" rule). Voice mode needs a `microphone` foreground service,
started while Colon is on screen (it is: voice mode always starts in the app). It is only started once the
RECORD_AUDIO permission is granted, because Android 14+ refuses a microphone service without it.

### Behaviour

- **Colon on screen**: the web voice screen shows; no pill. The notification is there (it has to be, for the
  foreground service).
- **Colon goes to the background while voice mode runs**: the chat page keeps running (MainActivity no longer
  pauses the WebView while voice mode is active) and a black pill appears at the top centre over other apps:
  small wave + "Listening…" / "Thinking…" / "Speaking" / "Mic muted".
  - **Tap** → expanded overlay: dimmed screen, the screen's rounded edges glow with a turning gradient (radius from
    `WindowInsets.getRoundedCorner` on Android 12+, 24 dp before), the live caption, a voice wave along the footer,
    and **Mute**, **Open Colon**, **Close**. Tapping outside the footer or **Close** goes back to the pill.
  - **Hold** (0.55 s) or **swipe** the pill away (48 dp) → ends voice mode.
- **Started from the Quick Settings tile or the "Talk to Colon" shortcut**: Colon opens, voice mode starts, and
  once the microphone service is up Colon steps back (`moveTaskToBack`) so you are back in the app you were in,
  with the pill. Only when "Display over other apps" is on; otherwise Colon stays open. The assistant gesture
  (long-press Home / corner swipe) still opens Colon as before.
- **Permission**: the first time voice mode starts without "Display over other apps", Colon asks once
  ("Show Colon over other apps?" → Open settings / Not now) and opens
  `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` for the package. Without it, the notification (Mute, End) is the
  background control.
- Swiping Colon out of recents ends voice mode (`onTaskRemoved`), and so does closing the chat screen.

### Manifest (`src/colonai/AndroidManifest.xml`)

`SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE_MICROPHONE`, and `<service .VoiceService foregroundServiceType=
"microphone">`. Colon Browser has none of this (the bridge refuses `voice_ui` there).

## 3. Device test checklist (Infinix SMART 20, Android 16, XOS, gesture navigation)

Install the 0.20.0 debug or release APK over 0.19.x.

In the app

- [ ] Empty composer → **Voice mode**: full-screen voice screen opens; orb breathes; label "Listening…".
- [ ] Speak: caption shows your words; on pause the orb turns violet ("Thinking…"), then blue/pink while the reply
      is read aloud with the reply's first words as caption; then listening again.
- [ ] Colon speech languages (Yorùbá, Hausa, Igbo, Naijá): the orb grows and shrinks with your voice.
- [ ] **Mute**: icon turns to mic-off, label "Mic muted", nothing is recorded; **Unmute** listens again. Mute while
      Colon speaks: the reply finishes, then it stays muted.
- [ ] **Show chat** hides the screen, chat and hands-free pill visible; tapping the pill text brings it back.
- [ ] **End** (X) closes the screen and stops listening/speaking; the composer button is "Voice mode" again.
- [ ] Settings › Accessibility › Remove animations on: orb is still, no pulsing.
- [ ] Light theme: the voice screen stays dark and readable.

Permission and background

- [ ] First voice mode on a fresh install: "Show Colon over other apps?" dialog appears once. **Not now**: never
      asked again; going Home leaves only the "Colon voice mode" notification (Mute / End work).
- [ ] Allow it in Settings (Apps › Colon AI › Display over other apps), start voice mode, swipe up to Home: the
      pill appears at the top centre, clear of the camera hole and readable over the XOS status bar.
- [ ] Talk while on the home screen / in WhatsApp: Colon still hears you, thinks and speaks (pill state follows).
- [ ] Tap the pill: full-screen glow follows the SMART 20's screen corners (no gap or clipping at the corners),
      wave animates along the footer above the gesture bar, caption updates.
- [ ] Tap outside the footer and **Close**: back to the pill. **Open Colon**: the chat opens, pill disappears,
      in-app voice screen still running.
- [ ] Hold the pill, and separately swipe it sideways / up: voice mode ends in both cases (pill, notification and
      in-app screen gone).
- [ ] Notification **Mute** / **End** work with Colon in the background.
- [ ] Quick Settings tile **Talk to Colon** from inside another app: Colon opens briefly, then you are back in that
      app with the pill listening. Same with the launcher shortcut.
- [ ] Swipe Colon AI out of recents: pill and notification go away.
- [ ] Leave voice mode running in the background for 5+ minutes: it keeps working (XOS battery manager may kill
      it; if so, note it and set Colon AI to "No restrictions" in battery settings).
- [ ] TalkBack: the pill reads "Colon voice mode: Listening…"; double-tap expands; the long-press action ends.
- [ ] Revoke "Display over other apps" while the pill shows: no crash; notification remains.
