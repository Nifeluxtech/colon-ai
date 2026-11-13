# Colon AI for Android

The Android app (ROADMAP Phase 7): Colon AI chat in a native shell, plus **Colon Browser** on Android System WebView
(Chromium) with one WebView per tab. Built in the cloud by GitHub Actions, so you never need Android Studio or a PC.

| | |
|---|---|
| App name | Colon AI (launcher), Colon Browser (browser screen) |
| Application id | `ng.nifelux.colonai` (debug builds: `ng.nifelux.colonai.debug`) |
| Android | 7.0 and newer (minSdk 24), targets Android 16 (API 36) |
| Version | from the root `package.json`; versionCode = major × 10000 + minor × 100 + patch (0.7.1 → 701) |
| Size | about 2 MB (release, shrunk with R8) |

## What is in the app (v0.7.1)

- **Colon AI shell** (`MainActivity`, `ShellWeb`, `NativeBridge`): loads `https://chat.apparatus.name.ng` with the
  `window.ColonNative` bridge (only on Colon's own pages), file picker for uploads, microphone for voice (Phase 6
  voice uses Colon speech in the app), Android back button, offline screen with retry, downloads (including chat
  exports), edge-to-edge with proper insets, system bars that follow the chat's light/dark theme. If the WebView's
  renderer is killed on a low-memory phone, the app rebuilds it instead of crashing.
- **Colon Browser** (`BrowserActivity`, `TabManager`, `BrowserWeb`): native address bar (URL or search), back,
  forward, reload/stop, home page with bookmarks, tabs (open, close, switch; 10 tabs on low-RAM phones, 30
  otherwise), only 2–5 live WebViews at once (older background tabs are discarded and reload when opened), history
  and bookmarks stored on the phone only, downloads through Android's DownloadManager, full-screen video, file
  uploads, camera/microphone asked per site, "Clear browsing data" that keeps you signed in to Colon AI.
  Colon Browser also appears in Android's "Open with" list for web links.
- **Saga control** (`BrowserSaga`, `ControlState`): AI / Manual / Shared indicator, Take control, Return to AI,
  Pause, Stop, a consent prompt before Saga may drive, and the commands in `docs/android-bridge.md`.
- **Backend bridge** (`BridgeClient`): WebSocket to `wss://api.apparatus.name.ng/ws` with reconnect, heartbeats and
  network awareness. Today's API only says hello (no Saga commands yet); the app shows that and keeps working.
- **Share to Colon** (`ShareReceiverActivity`, `ShareIntake`): share text, links or up to 5 images from any app →
  "Ask Colon AI" → they appear in the message box and upload tray.
- **Splash** (Android 12 SplashScreen API, backported to Android 7–11) with the Colon flame rising, then the web
  intro animation. Adaptive and themed launcher icons from `packages/brand`.
- **Updates** (`UpdateChecker`): every 12 hours the app reads
  `https://chat.apparatus.name.ng/android/version.json` (`apps/chat/public/android/version.json`). When there is a
  newer version it offers to download the APK, checks it is Colon AI, newer and signed with the same key, then opens
  Android's installer. Settings › App › "Check for updates" checks at once.
- **Notifications:** channels (updates, Saga browsing, general) and the Android 13 permission, asked only when
  needed. **Push (FCM) is not wired yet** — it needs a Firebase project, see "Next steps".

## Build in the cloud (GitHub Actions)

`.github/workflows/android.yml` runs on every push to `main` that touches `apps/android/**`, on tags `v*`, and by
hand (Actions › Android › Run workflow). It runs the unit tests and Android lint, builds the release APK, and keeps
it as an artifact for 30 days.

**Get the APK from a build:** GitHub › Actions › the latest "Android" run › scroll to Artifacts ›
`colon-ai-<version>-release` (or `-debug`) › download. It is a zip containing `colon-ai-<version>.apk`; open it with
your phone's file manager.

**Publish a release** (this is what the app's update prompt and the web "Get the Android app" link use): Actions ›
Android › Run workflow › tick **Publish a release** › Run. It creates the GitHub Release `v<version>` with
`colon-ai-<version>.apk`, its `.sha256`, and `colon-ai.apk` (same file, fixed name for
`releases/latest/download/colon-ai.apk`). Pushing a tag `v<version>` does the same. The tag must match
`package.json`, or the build stops.

## Install on a phone

1. Download `colon-ai-<version>.apk` from the release page on the phone.
2. Open it. Android asks to allow your browser (or file manager) to "Install unknown apps": allow it, go back,
   then tap Install.
3. Open Colon AI. Later updates are offered inside the app; Android asks once more to allow Colon AI to install
   updates.

**If Android says "App not installed":** the installed copy was signed with a different key (for example a test
build signed with a debug key). Uninstall Colon AI, then install the new APK. Set up the release key (below) before
sharing the app with anyone, so every later update installs over the top.

## Set up the release signing key (once, from your phone)

Without a release key every CI build is signed with a new throwaway debug key, so each test build needs an
uninstall first. The key never goes in this repo; it lives only in GitHub's encrypted repository secrets.

1. **Create a token that may write secrets** (GitHub's built-in token can't):
   GitHub › your avatar › Settings › Developer settings › Personal access tokens › **Fine-grained tokens** ›
   Generate new token. Name: `colon secrets`. Expiration: 7 days. Repository access: **Only select repositories** ›
   `colon-ai`. Permissions › Repository permissions › **Secrets: Read and write**. Generate, then copy the token.
2. **Store the token as a secret:** repository `colon-ai` › Settings › Secrets and variables › Actions ›
   New repository secret › Name `SECRETS_TOKEN`, Secret: paste the token › Add secret.
3. *(Recommended)* **Choose a backup passphrase:** add another secret `KEYSTORE_BACKUP_PASSPHRASE` with a long
   passphrase you will remember (16+ characters, for example five random words). Write it down somewhere safe.
4. **Create the key:** Actions › **Android signing key** › Run workflow › mode `create`, leave "replace" empty,
   tick **backup** if you did step 3 › Run. When it is green, Settings › Secrets › Actions shows
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
   The log shows only the public certificate SHA-256 fingerprint.
5. **Keep the backup:** open that run › Artifacts › `colon-signing-key-backup` › download, and keep the `.7z` file
   somewhere safe (Google Drive, a USB stick). It opens with ZArchiver using your passphrase. Then delete the
   artifact on the run page (it also expires after one day). You can make a new backup any time: run the workflow
   with mode `backup`.
6. **Clean up:** delete the `SECRETS_TOKEN` secret and the token itself (Settings › Developer settings). Run the
   "Android" workflow again: its summary no longer warns about debug signing.

Never run mode `create` with `REPLACE` unless the key is lost: phones with the old key can't update and must
reinstall. **Losing the key means every user has to uninstall and reinstall**, so keep the backup.

Advanced (with a PC): create a PKCS12 keystore with `keytool`, base64 it, and add the same four secrets by hand.

## Build on a computer (optional)

JDK 17 and the Android SDK (platform 36): `cd apps/android && ./gradlew testDebugUnitTest lintDebug assembleDebug`.
The APK is in `app/build/outputs/apk/`. With `ANDROID_KEYSTORE_FILE` and the three password/alias variables set,
`assembleRelease` signs with your key.

## Code map

All Kotlin is in one package, `app/src/main/kotlin/ng/nifelux/colonai/` (one folder keeps GitHub web uploads short).

| File | What it does |
|---|---|
| `ColonApplication.kt` | OkHttp client, bridge, network monitor, notification channels |
| `MainActivity.kt`, `ShellWeb.kt` | Colon AI shell, WebView settings and navigation policy |
| `NativeBridge.kt` | `window.ColonNative` (origin-restricted) |
| `ShareReceiverActivity.kt`, `ShareIntake.kt` | Share-to-Colon and chat links from other apps |
| `BrowserActivity.kt`, `BrowserWeb.kt`, `TabManager.kt` | Colon Browser, tab WebViews, tab memory policy |
| `BrowserSaga.kt`, `ControlState.kt` | AI / Manual / Shared control and bridge commands |
| `BrowserStore.kt`, `BrowserData.kt`, `HomePage.kt`, `EntryList.kt` | history, bookmarks, clear data, new-tab page, lists |
| `BridgeClient.kt`, `BridgeProtocol.kt`, `Backoff.kt` | backend WebSocket bridge (`docs/android-bridge.md`) |
| `UpdateChecker.kt`, `VersionManifest.kt` | in-app updates |
| `Downloads.kt`, `FileChooser.kt`, `External.kt`, `Notifications.kt`, `UrlRules.kt` | platform helpers |

Unit tests (JVM, no emulator): `app/src/test/kotlin/ng/nifelux/colonai/` — URL rules and the bridge origin check,
backoff, update manifest, bridge protocol, control state machine, tab discarding, history list, home-page escaping.

## Next steps (not in 0.7.1)

- **Backend side of the bridge** (`docs/android-bridge.md`, "What the backend must add") and Saga commands that
  read and act on pages (Phase 9).
- **Push notifications:** create a Firebase project, add `google-services.json` as a base64 repository secret that
  CI writes before building (never committed), add the FCM dependency and a messaging service, and an API endpoint
  to register tokens. Until then the app has channels and permission plumbing only.
- **Native dictation** with Android's SpeechRecognizer for live English captions (the app uses Colon speech now).
- **Google sign-in inside the app:** Google blocks sign-in in WebViews; use a Chrome Custom Tab and return to the app
  (Phase 8). Email and password sign-in works today.
- **App Links:** publish `/.well-known/assetlinks.json` on chat.apparatus.name.ng with the release certificate
  fingerprint so chat links open the app without asking.
- Incognito tabs, find in page, site settings, and syncing tabs to the backend session manager (Phase 8).
- Crash reporting to measure the >99% crash-free release standard, and testing on low/mid/high-end phones.
