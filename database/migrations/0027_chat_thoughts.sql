-- Colon AI 0.32.0: a reply's "Thought process" (the skills it used and the model's reasoning summary).
-- New column only; NULL for replies without one. Up to 20,000 characters (chat/reply.js THOUGHTS_MAX).

ALTER TABLE chat_messages
  ADD COLUMN thoughts MEDIUMTEXT NULL;
