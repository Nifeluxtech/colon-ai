# Changelog

## [0.3.0] — 2026-11-11 · Colon AI + Colon Browser interfaces (UI)
Frontend only: no changes to `services/api`, `database/migrations`, `.cpanel.yml` or server configuration.
### Added
- **Design system v2** (`packages/ui`): royal-blue tokens from the UI spec (#4169E1, #3457C7, #101B3D, #080F24, #EAF0FF, #38BDF8, #0F172A, #64748B, #E2E8F0, #16A34A, #DC2626), light and dark themes with no flash, self-hosted Inter and JetBrains Mono (OFL), new flame logo "COLON AI by Nifelux", glass surfaces, and shared components with every state (default, hover, active, focus, disabled, loading, error): buttons, inputs, switches, segmented controls, chips, popover menus with keyboard navigation, confirm and prompt dialogs, tooltips, drawers, toasts with actions, loaders, progress, skeletons, resizable split handles, 94 inline SVG icons. `visualViewport` tracking keeps inputs above the on-screen keyboard.
- **Colon AI** (`apps/chat`): welcome screen ("What can we explore today?", four prompt cards, Study / Developer / Research modes, input with attach and mic, Attach File / Voice Input / Browse the Web), chat workspace with collapsible sidebar (New Chat, search, Saved, Recent, History, Settings, Help, account), header (sidebar toggle, title rename, model selector, new chat, browser, theme, profile), token-by-token streaming with stop, Markdown, highlighted code with copy, tables, maths, citations and source cards, copy / regenerate / feedback with reasons / read aloud, auto-growing input, mode kept per conversation, model list from configuration, rename / pin / archive / delete with confirmation, uploads (images, PDF, documents, text) with previews, progress, validation and error states, voice input (live dictation or voice notes, with permission-denied, no-microphone and unsupported states), Settings (account, appearance, language, voice, chat preferences, privacy, data export and deletion, sign out), History, Saved, Explore and Help screens, and the integrated browser in embedded and split modes (resizable on desktop, switchable on mobile) sharing one browser session.
- **Colon Browser** (`apps/browser`): standalone app with sidebar (Home, Tabs with count, Bookmarks, History, Downloads, AI Browse, Settings, Help), address bar for URLs and searches with suggestions, back / forward / refresh / home / bookmark / download / full screen, tabs with a mobile tab overview, bookmarks with folders, date-grouped searchable history, downloads and uploads, settings (homepage, search engine, appearance, privacy, permissions, downloads, sessions, clear data), session restore, and visually distinct AI / Manual / Shared control modes with Take Control, Return to AI, Pause AI and Stop. Handoff pauses pending automation before the user takes over. The AI Browse panel shows the task, current site, progress, steps, an action log and sources; Shared mode asks for approval before each action.
- Honest **web reader preview** (docs/adr/0002): pages are fetched as data, sanitised and rendered without scripts; private and local addresses are blocked by a unit-tested URL guard; sites that refuse cross-origin reads show an "open in new tab / Android app" state.
- **Data adapters** (`apps/chat/public/js/chat-data.js`, `packages/ui/assets/colon-browser-data.js`): every new screen works today on an in-browser implementation (IndexedDB, simulated streaming, on-device preview replies labelled "Preview") and switches to the API with `localStorage['colon.data'] = 'remote'`. Expected endpoints: `docs/frontend-data-adapters.md`.
- Unit tests (`node --test "packages/ui/test/*.test.js"`) for the Markdown renderer, URL/SSRF guard, preview responder and storage; CI runs them.
### Changed
- The animated intro and the Admin Dashboard pick up the new royal-blue brand through the shared design system. Account screens gain an Appearance (theme) control.

## [0.2.0] — 2026-11-11 · Phase 2: Accounts & security
### Added
- Accounts: register, sign in, Google sign-in (when `GOOGLE_CLIENT_ID` is set), email verification and password reset through Brevo (when `BREVO_API_KEY` is set).
- Sessions: httpOnly, Secure, SameSite=Lax cookie shared across Colon apps; device list, sign out one device or all others.
- Roles: Member, Moderator, Admin, Super Admin (`OWNER_EMAIL` becomes Super Admin). TOTP two-factor, required for every staff role.
- Security: scrypt password hashing, AES-256-GCM for 2FA secrets, MySQL-backed rate limits, lockout after 5 failed passwords, CSRF header + origin check, input validation, security headers, audit log.
- Profile with language preference (English, Naijá, Yorùbá, Hausa, Igbo), draft Terms and Privacy, account deletion.
- Admin: overview stats, users and roles, unlock, sign out a user, audit log.
- `packages/ui`: Colon design system and app core. Mobile-first: bottom tab bar, desktop sidebar, safe areas, bottom sheets, smooth route transitions.
- Database migrations now run automatically on API start (`0002_auth`).
### Changed
- Root `package.json` no longer uses npm workspaces, so cPanel installs API packages inside `services/api`.

## [0.1.0] — 2026-11-11
### Added
- Monorepo structure for Nifelux · Colon AI.
- `services/api`: Node 24 API with `/health` and the `/ws` WebSocket gateway.
- `apps/chat`, `apps/browser`, `apps/admin`: app shells with the animated COLON logo intro.
- cPanel Git deployment (`.cpanel.yml`), CI syntax check, and docs.
