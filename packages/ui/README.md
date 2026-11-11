# packages/ui · Colon design system

Shared by every Colon web app and deployed to `/ui/` on each subdomain by `.cpanel.yml`. No build step,
no frameworks: plain CSS and classic scripts loaded with `defer`.

## Files (`assets/`)
| File | What it is |
|---|---|
| `colon-ui.css` | Tokens, light and dark themes, and every shared component |
| `colon-app.js` | App core `window.Colon`: API client, hash router, account screens, theme, menus, dialogs, tooltips, drawer, keyboard and resize helpers, icon set |
| `colon-store.js` | `ColonStore`: IndexedDB records + settings, with localStorage/memory fallback |
| `colon-markdown.js` | `ColonMarkdown`: safe Markdown, code highlighting, tables, TeX maths, citations |
| `colon-url.js` | `ColonURL`: address-bar parsing and the client-side SSRF guard |
| `colon-browser-data.js` | `ColonBrowserData`: the one browser-session adapter (local + remote) and HTML sanitiser |
| `colon-saga-browse.js` | `ColonSagaBrowse`: observable AI browsing (plan, act, approve, pause, stop) |
| `colon-browser.js` + `colon-browser.css` | `ColonBrowser`: the reusable browser module (full and panel variants) |
| `fonts/` | Self-hosted Inter and JetBrains Mono (OFL) |

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
