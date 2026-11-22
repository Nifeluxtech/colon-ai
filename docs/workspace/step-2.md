# Workspace step 2 — chat builds the site (v0.26.0, Nov 22, 2026)

## What shipped
- **API** (`services/api/src/modules/workspace/`):
  - `chat.js` — `createChat({ engine, deps })`: `send()` saves the user message and runs the reply in the
    background (one at a time per workspace, 409 `busy` otherwise); `history()` returns messages + `working`.
  - `prompt.js` — Workspace rules + file tree + text file contents (60k-char budget; index.html and files named in
    the message first). Images/fonts are listed, never sent.
  - `edits.js` — parses the reply format and applies SEARCH/REPLACE edits (exact, then whitespace-tolerant).
  - `index.js` `applyOps()` — validates every op, then writes them as ONE version (`before`/`version`/`changes`).
  - `handlers.js` — `getChat`, `postChat` (safety check, routing, daily limits consumed and refunded on failure,
    4-minute cap, `ai_calls` record with route `workspace`). `setChatDeps()` for tests.
  - Routes: `GET /workspaces/:id/chat`, `POST /workspaces/:id/chat { message }` → 202.
- **DB**: `database/migrations/0021_workspace_chat.sql` (`colon_workspace_messages`).
- **App**: `apps/chat/src/components/workspace-chat.js` mounted in the Chat tab (`pages/workspace.js`): bubbles,
  "N files changed" card with Created/Edited/Deleted rows, Undo (restore `version_before`, shown only while the
  reply is the newest change), idea chips, sticky composer, polling every 2.5 s while working. Styles at the end of
  `chat-workspace.css`.
- **Tests**: `services/api/tests/unit/workspace-chat.test.js` (parse, applyEdit, applyOps, prompt, chat flow).

## Reply format the model must use
```
Short note for the user.
=== FILE: index.html
(full content)
=== END
=== EDIT: style.css
<<<<<<< SEARCH
(exact old lines)
=======
(new lines)
>>>>>>> REPLACE
=== END
=== DELETE: old.html
```

## Device test checklist
1. Open a workspace → Chat tab shows three idea chips; tap one, send.
2. "Colon is building your site…" appears; within ~1–2 min a reply lists the files changed.
3. Files tab shows the new/changed files; History has a "Chat: …" version.
4. Send "make the header blue" → only style.css (or the header file) changes.
5. Tap Undo on the newest reply → toast "Change undone."; Undo disappears; files are back.
6. Send two messages fast → second is refused with "Colon is still working on your last message."

## For step 3
Preview renders `GET /workspaces/:id/bundle` in a sandboxed iframe (blob URLs / srcdoc with rewritten relative
links); refresh it when the chat's `onChanged` fires. Code tab = Monaco (`components/code-edit.js`) + `PUT /file`.
