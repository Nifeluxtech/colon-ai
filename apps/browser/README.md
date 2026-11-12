# Colon Browser
The Colon Browser web app. Deployed to browser.apparatus.name.ng. The full browser engine runs in the Android app
(WebView); see [docs/decisions/0002](../../docs/decisions/0002-webview-browser-engine.md).

On the web it runs the **reader preview**: pages are fetched as data, sanitised and shown as text and images
(no scripts, logins or forms). The UI says so wherever it matters.

| Path | Purpose |
|---|---|
| `public/index.html` | The page: versioned CSS and `src/main.js` from `/v<version>/` |
| `public/assets/css/browser.css` | Shell layout |
| `src/main.js` | Boot only: loads the UI kit (browser module and session) and the app |
| `src/core/` | `state.js` (`window.CB`, sections, limits), `app.js` (shell and navigation: Home, Tabs, Bookmarks, History, Downloads, AI Browse, Settings, Help) |
| `src/components/chrome.js` | Toolbar state, menus and the building blocks the section pages use |
| `src/pages/` | `index.js` (pages by route), `tabs.js`, `bookmarks.js`, `history.js`, `downloads.js`, `settings.js`, `help.js` |

The browser itself (`ColonBrowser`), its session adapter (`ColonBrowserData`) and AI browsing (`ColonSagaBrowse`)
live in `packages/ui/js/browser/` because Colon AI's browser panel uses the same module and session.
