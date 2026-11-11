# Colon Browser
The Colon Browser web app. Deployed to browser.apparatus.name.ng. The full browser engine runs in the Android app (WebView); see docs/adr/0002.

On the web it runs the **reader preview**: pages are fetched as data, sanitised and shown as text and images
(no scripts, logins or forms). The UI says so wherever it matters.

| File | Purpose |
|---|---|
| `public/index.html` | Boot: loads `/ui/*` and registers routes (Home, Tabs, Bookmarks, History, Downloads, AI Browse, Settings, Help) |
| `public/js/browser-app.js` | App shell, mobile bottom controls and menu, and the section pages |
| `public/css/browser.css` | Shell layout |

The browser itself (`ColonBrowser`), its session adapter (`ColonBrowserData`) and AI browsing (`ColonSagaBrowse`)
live in `packages/ui/assets` because Colon AI's browser panel uses the same module and session.
