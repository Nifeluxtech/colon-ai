# packages/ui · Colon design system

Shared by every Colon web app and deployed to `/ui/` on each subdomain by `.cpanel.yml`.

- `assets/colon-ui.css`: design tokens and components (app shell, bottom tab bar, sidebar, cards, lists, forms, buttons, sheets, toasts, skeletons). Mobile-first; sidebar from 900 px.
- `assets/colon-app.js`: app core. `Colon.start({ app, title, nav, routes })` boots an app with the API client, hash router (View Transitions, scroll memory), and the shared account screens: sign in, sign up, reset, verify, profile, security (2FA, password, delete), devices, terms, privacy.

Rules: 16 px inputs (no zoom on focus), 44 px+ touch targets, safe-area insets, `prefers-reduced-motion` respected, no external fonts or frameworks.
