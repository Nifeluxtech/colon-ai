# packages/ui · Colon design system

Shared by every Colon web app. No build step, no frameworks: plain CSS and ES modules loaded directly by the
browser. Deployed with each app under `/v<version>/packages/ui/` by `scripts/deploy/build-docroot.sh` (fonts are also
mirrored at `/ui/fonts/` for older URLs).

## Files
| Path | What it is |
|---|---|
| `css/tokens.css`, `base.css`, `components.css`, `content.css` | Tokens and themes, app shell and surfaces, components, rendered content |
| `css/browser.css` | The browser module's styles |
| `js/colon.js` | Public face of the app core, `window.Colon` (same keys as before the module split): built from `js/colon/` (`state`, `icons`, `dom`, `api`, `overlays`, `forms`, `router`, `auth`, `account`, `account-security`) |
| `js/store.js` | `ColonStore`: IndexedDB records + settings, with localStorage/memory fallback |
| `js/markdown/index.js` | `ColonMarkdown`: safe Markdown, code highlighting, tables, TeX maths, citations (`escape`, `parse`, `code-blocks`, `math`) |
| `js/url.js` | `ColonURL`: address-bar parsing and the client-side SSRF guard |
| `js/browser/data.js` | `ColonBrowserData`: the one browser-session adapter (local + remote) and HTML sanitiser |
| `js/browser/saga-browse.js` | `ColonSagaBrowse`: observable AI browsing (plan, act, approve, pause, stop) |
| `js/browser/index.js` | `ColonBrowser`: the reusable browser module (full and panel variants), split over a shared context |
| `fonts/` | Self-hosted Inter and JetBrains Mono (OFL) |
| `test/` | `node --test` unit tests |

Apps import only the entry files above (`colon.js`, `store.js`, `url.js`, `markdown/index.js`, `browser/index.js`,
`browser/data.js`, `browser/saga-browse.js`); `scripts/check.js` enforces it.

## Tokens (spec §19)
Primary `#4169E1` · hover `#3457C7` · deep navy `#101B3D` · dark background `#080F24` · light background `#FFFFFF`
· light blue surface `#EAF0FF` · cyan accent `#38BDF8` · text `#0F172A` · secondary text `#64748B` · border `#E2E8F0`
· success `#16A34A` · error `#DC2626`. Raw values live in `--c-*`; components use semantic variables
(`--bg`, `--surface`, `--glass`, `--line`, `--text`, `--muted`, `--primary`…) that switch with the theme.

## Themes
`<html data-theme="dark|light">`. `Colon.theme.get() / set('dark'|'light'|'system') / toggle() / on(fn)`.
Each app applies the saved theme in an inline `<head>` script so there is no flash.

## Components
Buttons (`.btn` primary / secondary / ghost / danger, `.sm` `.xs` `.block` `.pill`, `.is-loading`, `[disabled]`),
icon buttons (`.icon-btn`, `aria-pressed`), inputs (`.input` `.select` `.textarea`, `.field.err`), switches,
segmented controls (`.seg`), chips (`.chip`, `aria-pressed|checked`), cards and glass surfaces, lists and settings
rows, badges and status dots, banners, toasts (`Colon.toast(msg, kind, action)`), sheets/modals
(`Colon.sheet`, `Colon.confirm`, `Colon.prompt`), popover menus (`Colon.menu`, arrow-key navigation),
tooltips (`data-tip`), drawers (`Colon.drawer`), loaders (`.spin`, `.typing`, `.progress`, `.skel`),
empty states, resizable split handles (`Colon.resizable`), rendered Markdown (`.md`), and 90+ inline SVG
icons (`Colon.icon(name)`).

## Rules
Mobile-first from 320 px; 44 px touch targets; 16 px inputs (no zoom on focus); visible `:focus-visible`;
safe-area insets; the on-screen keyboard is tracked with `visualViewport` (`Colon.keyboard()` sets `--vvh`,
`--kb`); `prefers-reduced-motion` respected; no third-party CDNs.

## Tests
`node --test "packages/ui/test/*.test.js"` (Node 22+).
