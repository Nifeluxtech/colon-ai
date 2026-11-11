# Colon AI — Chat
The Colon AI chat web app (Colon Saga). Deployed to chat.apparatus.name.ng.

| File | Purpose |
|---|---|
| `public/index.html` | Boot: loads `/ui/*` and the files below, registers the workspace routes |
| `public/js/chat-app.js` | Workspace: sidebar, header, welcome, thread, streaming, edit, share, composer, modes, model selector, browser panel, guest Log in / Sign up |
| `public/js/chat-pages.js` | History, Saved, Explore, Help & Support, and the log-in screen guests see for History/Saved/Settings |
| `public/js/chat-settings.js` | Settings: account, appearance, language, voice, chat, privacy, data, sign out |
| `public/js/chat-media.js` | Attachments (validation, previews, progress, errors) and voice input |
| `public/js/chat-data.js` | **The data adapter**: Remote (signed in, default), Guest (signed out, nothing saved) and Local (on-device Preview when the API is down). Endpoints are documented at the top and in `docs/frontend-data-adapters.md` |
| `public/js/chat-responder.js` | On-device preview replies used only by the local adapter |
| `public/config/models.json` | Offline stand-in for `GET /models` (Preview only) |
| `public/css/chat.css` | Workspace layout (mobile-first, desktop from 900 px) |
