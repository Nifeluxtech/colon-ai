# Colon AI and Colon Browser for Android

Two Android apps from one Gradle project (ROADMAP Phases 7–8), both on Android System WebView (Chromium) and built
in the cloud by GitHub Actions, so you never need Android Studio or a PC. The code is shared (`app/src/main`); each
app is a **product flavor** with its own manifest, name, icon and splash.

| | Colon AI (`colonai`) | Colon Browser (`colonbrowser`) |
|---|---|---|
| What it is | the chat, with a real browser panel beside it | the full standalone browser |
| Application id | `ng.nifelux.colonai` (debug: `….colonai.debug`) | `ng.nifelux.colonbrowser` (debug: `….colonbrowser.debug`) |
| Opens into | `MainActivity` (chat) | `BrowserActivity` (browser) |
| Sources | `app/src/main` + `app/src/colonai` | `app/src/main` + `app/src/colonbrowser` |
| Release APK | `colon-ai-<version>.apk` / `colon-ai.apk` | `colon-browser-<version>.apk` / `colon-browser.apk` |
| Update entry | top level of `version.json` | `browser` in `version.json` |

Both: Android 7.0 and newer (minSdk 24), target Android 16 (API 36), version from the root `package.json` with
versionCode = major × 10000 + minor × 100 + patch (0.8.0 → 800), same release signing key, a few MB each (release,
shrunk with R8).

## What is in the apps (v0.9.1)

**Colon AI**
- **Chat shell** (`MainActivity`, `ShellWeb`, `NativeBridge`): loads `https://chat.apparatus.name.ng` with the
  `window.ColonNative` bridge (only on Colon's own pages), file picker, microphone (Colon speech), back button,
  offline screen, downloads and chat exports, edge-to-edge insets, system bars that follow the chat theme, and
  recovery when a low-memory phone kills the renderer.
- **In-chat browser panel** (`ChatBrowserPanel`, `PanelLayout`): web pages from the chat (links, the Browser button,
  `ColonNative.browser('open', …)`) open in a real WebView **beside the chat**, not in a separate screen.
  Layouts: **inline** (v0.9.1, phones' default: inside the conversation, over the Colon Browser card the chat
  draws, scrolling with the thread and clipped between the chat header and the composer; `InlineGeometry`,
  `InlineLayer`; the card's header is the web's), **embedded** (above the chat, collapsible to its header),
  **split** (draggable divider; stacked on phones, side by side on wide landscape screens) and **full screen**;
  switching only moves or resizes views, so nothing reloads. Header (all layouts but inline): Saga mode chip, address bar, back, reload/stop, expand, menu (forward, layouts, tabs, desktop site, share,
  downloads, Saga status, clear data, close all tabs) and close. **Open in Colon Browser** hands the page to the
  browser app, or offers its download when it isn't installed. Saga's AI / Manual / Shared control, consent prompt,
  shield and Take control / Return to AI / Pause / Stop work in the panel exactly as in Colon Browser.
  Up to 6 tabs, with their own history and downloads list (`BrowserStore("colon.panel")`).
- **Share to Colon** (`ShareReceiverActivity`, `ShareIntake`) and chat links from other apps.

**Colon Browser**
- **Browser** (`BrowserActivity`, `BrowserMenu`, `TabManager`, `BrowserWeb`): address and search bar, back, forward,
  reload/stop, home page with bookmarks, tabs (10 on low-RAM phones, 30 otherwise, only 2–5 live WebViews), history,
  bookmarks, downloads (DownloadManager, plus an in-app **downloads list**), file uploads, camera/microphone per
  site, **full-screen video**, **desktop site** per tab, share, "Ask Colon AI about this page" (shares it into
  Colon AI), web searches from other apps (`WEB_SEARCH`), and Android's "Open with" for web links.
- **Tabs and history survive restarts** (`TabSnapshot`): open tabs (URL, title, desktop flag, active tab) are saved
  as they change and restored as lightweight tabs that load when opened.
- **Private tabs** (`PrivateBrowsing`, `PrivateProfiles`): violet address bar and "Private" in the tab list, no
  history, no cache, never saved for the next launch, never readable by Saga. On WebViews with profile support
  (androidx.webkit `MULTI_PROFILE`) they get their own cookie jar and site storage in a throwaway profile, deleted
  when the last private tab closes (or on the next launch if the app was killed). On older WebViews the app says
  plainly that cookies can't be separated before it opens one.
- **Clear browsing data** screen (`ClearDataActivity`): history, cookies, cached files, site storage and the
  downloads list, each on its own; your Colon AI sign-in is kept.
- **Google and bank sign-in** (`SignInTabs`, `UrlRules.CUSTOM_TAB_HOSTS`): `accounts.google.com`,
  `accounts.youtube.com` and the internet-banking hosts of GTBank, Access, Zenith, UBA and First Bank open in a
  Chrome Custom Tab (never in Colon Browser itself), and the tab reloads when you come back. Add hosts in
  `UrlRules.BANK_SIGNIN_HOSTS`, or at build time: `./gradlew -Pcolon.customTabHosts=ibank.example.ng,.bank.example`.
  Sign-ins made in the Custom Tab belong to that browser, not to the WebView.
- Cookies, logins, history and bookmarks stay on the phone (nothing is uploaded).

**Both apps**
- **Saga control** (`BrowserSaga`, `ControlState`) and the **backend bridge** (`BridgeClient`, `docs/android-bridge.md`).
- **Saga browsing (v0.9.0, both apps):** Saga's page tools run on the tab it drives: read the page, list links,
  click, type, scroll (`assets/saga/tools.js`, injected per command) and a small screenshot (`SagaTools`).
  Payments, purchases, form submissions, messages and personal details wait for **Approve** on the phone
  (`SagaApproval`: the server's request or the phone's own check of the real element); in Shared mode every step
  that changes the page asks first. In Colon AI the browser panel opens by itself when Saga asks to browse.
- **Updates** (`UpdateChecker`, `VersionManifest.forApp`): every 12 hours each app reads its own entry of
  `https://chat.apparatus.name.ng/android/version.json` and only accepts an APK named for itself, from the same
  package, newer, and signed with the same key.
- **Splash** (SplashScreen API, backported) and adaptive/themed launcher icons: the Colon flame for Colon AI, a cyan
  globe around the flame for Colon Browser.
- **Notifications:** channels and the Android 13 permission; **push (FCM) is not wired yet**.

## Build in the cloud (GitHub Actions)

`.github/workflows/android.yml` runs on every push to `main` that touches `apps/android/**`, on tags `v*`, and by
hand (Actions › Android › Run workflow). It runs the unit tests and Android lint **for both apps**, builds both
release APKs, and keeps them as one artifact for 30 days.

**Get the APKs from a build:** GitHub › Actions › the latest "Android" run › scroll to Artifacts ›
`colon-android-<version>-release` (or `-debug`) › download. The zip holds `colon-ai-<version>.apk` and
`colon-browser-<version>.apk` (plus fixed-name copies and `.sha256` files); open them with your phone's file manager.

**Publish a release** (what the apps' update prompts and the web "Get the app" links use): Actions › Android ›
Run workflow › tick **Publish a release** › Run. It creates the GitHub Release `v<version>` with
`colon-ai-<version>.apk`, `colon-browser-<version>.apk`, the fixed-name copies `colon-ai.apk` and
`colon-browser.apk` (for `releases/latest/download/…`), and a `.sha256` for each. Pushing a tag `v<version>` does the
same. The tag must match `package.json`, or the build stops.

## Install on a phone

1. Download `colon-ai-<version>.apk` and/or `colon-browser-<version>.apk` from the release page on the phone.
2. Open it. Android asks to allow your browser (or file manager) to "Install unknown apps": allow it, go back,
   then tap Install.
3. Open the app. Later updates are offered inside each app; Android asks once more to allow the app to install
   updates. The two apps install side by side and update separately.

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

JDK 17 and the Android SDK (platform 36), from `apps/android`:
`./gradlew testColonaiDebugUnitTest testColonbrowserDebugUnitTest lintColonaiDebug lintColonbrowserDebug
assembleColonaiDebug assembleColonbrowserDebug`. APKs are in `app/build/outputs/apk/<flavor>/<type>/`. With
`ANDROID_KEYSTORE_FILE` and the three password/alias variables set, `assembleColonaiRelease
assembleColonbrowserRelease` sign with your key. On an ARM64 Linux machine pass an ARM64 `aapt2` with
`-Pandroid.aapt2FromMavenOverride=<path>` (Google's build-tools ship x86-64 binaries only).

## Code map

All Kotlin is in one package, `app/src/main/kotlin/ng/nifelux/colonai/` (one folder keeps GitHub web uploads short),
shared by both apps. Per-app files: `app/src/colonai/` (manifest, share-target resources) and `app/src/colonbrowser/`
(manifest, name, icon, splash, update texts).

| File | What it does |
|---|---|
| `ColonApplication.kt` | OkHttp client, bridge, network monitor, notification channels |
| `MainActivity.kt`, `ShellWeb.kt` | Colon AI shell, WebView settings and navigation policy |
| `ChatBrowserPanel.kt`, `PanelLayout.kt` | Colon AI's in-chat browser panel and its layouts |
| `NativeBridge.kt` | `window.ColonNative` (origin-restricted) |
| `ShareReceiverActivity.kt`, `ShareIntake.kt` | Share-to-Colon and chat links from other apps |
| `BrowserActivity.kt`, `BrowserMenu.kt` | Colon Browser screen, menu and lists |
| `BrowserHost.kt`, `BrowserWeb.kt`, `TabManager.kt`, `TabSnapshot.kt` | shared tab engine, WebView clients, memory policy, saved tabs |
| `PrivateBrowsing.kt`, `PrivateProfiles.kt` | private tab rules and their throwaway WebView profile |
| `SignInTabs.kt`, `UserAgents.kt`, `Fullscreen.kt`, `PermissionAsker.kt` | Custom Tab sign-in, desktop site, full-screen video, permissions |
| `ClearDataActivity.kt`, `Handoff.kt` | clear browsing data screen; moving between the two apps |
| `BrowserSaga.kt`, `ControlState.kt` | AI / Manual / Shared control and bridge commands |
| `SagaTools.kt`, `assets/saga/tools.js` | Saga's page tools, screenshots and the approval decision (Phase 9) |
| `BrowserStore.kt`, `BrowserData.kt`, `HomePage.kt`, `EntryList.kt` | history, bookmarks, clear data, new-tab page, lists |
| `BridgeClient.kt`, `BridgeProtocol.kt`, `Backoff.kt` | backend WebSocket bridge (`docs/android-bridge.md`) |
| `UpdateChecker.kt`, `VersionManifest.kt` | in-app updates |
| `Downloads.kt`, `FileChooser.kt`, `External.kt`, `Notifications.kt`, `UrlRules.kt` | platform helpers |

Unit tests (JVM, no emulator, run for both flavors): `app/src/test/kotlin/ng/nifelux/colonai/` — URL rules and the
bridge origin check, backoff, update manifest (per app), bridge protocol, control state machine, tab discarding,
history and downloads lists, home-page escaping, tab persistence, private-tab rules, Custom Tab hosts, desktop user
agent, panel layouts, clear-data rules and the app handoff.

## Next steps (not in 0.9.0)

- **Saga on real phones:** run multi-step tasks, injection pages and approvals on low, mid and high-end devices
  (the Phase 9 Kotlin code was written without a local Android build; CI builds it).
- **Push notifications** (FCM: Firebase project, `google-services.json` as a CI secret, token endpoint).
- **Native dictation** with Android's SpeechRecognizer.
- **App Links:** `/.well-known/assetlinks.json` on chat.apparatus.name.ng with the release certificate fingerprint.
- Find in page, site settings, per-site permissions list, and syncing tabs to the session manager (opt-in).
- Crash reporting for the >99% crash-free standard, and testing on low/mid/high-end phones (including private tabs
  on old WebViews, Custom Tab sign-in round trips and the split divider on small screens).
