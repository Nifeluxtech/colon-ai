# Colon OS Assistant

Android voice assistant module for Colon AI ("Hey Colon").

- `plan.md`: the agreed 5-step plan using the best free tools. **Source of truth** wherever it differs from the blueprint.
- `blueprint-original.md`: the original production blueprint (architecture, Kotlin structure, API, MySQL tables, phases, release checklist).

Note: the existing app in `apps/android` already has the WebView shell, `window.ColonNative` bridge, voice input
(`POST /voice/transcribe`), read-aloud (`POST /voice/speak`) and hands-free mode (Phase 6). Step 1 therefore adds
the missing native assistant entry point (Android assist / long-press Home) on top of that.
