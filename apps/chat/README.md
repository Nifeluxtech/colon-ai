# Colon AI — Chat
The Colon AI chat web app (Colon Saga). Deployed to chat.apparatus.name.ng.

| File | Purpose |
|---|---|
| `public/index.html` | Boot: loads `/ui/*` and the files below, registers the workspace routes |
| `public/js/chat-app.js` | Workspace: sidebar, header, welcome, thread, streaming, composer, modes, model selector, browser panel |
| `public/js/chat-pages.js` | History, Saved, Explore, Help & Support |
| `public/js/chat-settings.js` | Settings: account, appearance, language, voice, chat, privacy, data, sign out |
| `public/js/chat-media.js` | Attachments (validation, previews, progress, errors) and voice input |
| `public/js/chat-data.js` | **The data adapter** (local preview + remote API). Expected endpoints are documented at the top and in `docs/frontend-data-adapters.md` |
| `public/js/chat-responder.js` | On-device preview replies used only by the local adapter |
| `public/config/models.json` | Local stand-in for `GET /models` |
| `public/css/chat.css` | Workspace layout (mobile-first, desktop from 900 px) |
