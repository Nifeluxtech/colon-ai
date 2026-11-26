-- Colon AI 0.38.0: photos sent in the Workspace chat (a screenshot or a design to build from).
-- New column only; NULL for messages without photos. A JSON list of { id, name, type, size, kind } (chat_attachments).

ALTER TABLE colon_workspace_messages
  ADD COLUMN images JSON NULL;
