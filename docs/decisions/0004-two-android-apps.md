# ADR 0004: Colon AI and Colon Browser as two APKs from one Android project

**Status:** accepted (2026-11-13, v0.8.0)

Phase 8 makes Colon Browser a standalone product. We ship it as its **own APK** (`ng.nifelux.colonbrowser`, name
"Colon Browser", its own icon and splash, opening straight into the browser) next to Colon AI
(`ng.nifelux.colonai`), built from the **same Gradle project with two product flavors** (`colonai`,
`colonbrowser`). All code stays in `app/src/main`; each flavor only adds its manifest (which activities exist and
which one launches) and a few resources.

Why:
- The ROADMAP standing rule says the browser is one reusable module, never duplicated. Flavors share every Kotlin
  file (`BrowserHost` is implemented by both the standalone `BrowserActivity` and Colon AI's in-chat
  `ChatBrowserPanel`), so a fix lands in both apps.
- Separate application ids keep the two installs independent (own storage, own cookies, own updates) while one
  CI run, one signing key and one release carry both.
- Colon AI no longer has a standalone browser screen: browsing in Colon AI happens in the panel beside the chat
  (Phase 10 layouts), and "Open in Colon Browser" hands a page to the other app (or offers its download).

Consequences:
- `version.json` serves both apps: top-level fields are Colon AI (unchanged, so v0.7.x apps keep updating) and
  `browser` is Colon Browser. Each app reads only its entry and accepts only an APK named for itself.
- The release has four APK assets (versioned and fixed names for each app) plus checksums.
- The two apps don't share cookies or history (Android sandboxes them). A shared browsing session across both apps
  needs the backend session manager (`docs/phase8-backend-contract.md`).
