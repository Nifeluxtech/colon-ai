-- Colon AI Phase 5: web search with cited sources for Research mode.
-- The sources themselves go in the existing chat_messages.sources column (added in 0003, used by AI Browse notes).
-- This adds how the search went for each answer: { ok, provider, ms, read } (no query text, no page text).
-- New column only; NULL for every reply that didn't search.

ALTER TABLE chat_messages
  ADD COLUMN web_search JSON NULL;
