-- Colon AI Phase 10: one browser per conversation (ROADMAP "Browser inside chat & control modes").
-- browser_sessions gains conversation_id: the session manager keeps one session per user, device AND chat. ''
-- (the default) is the device-wide session every client used before (Colon Browser, older apps, the web
-- browser app), so existing rows keep working unchanged. The unique key moves from (device_ref) to
-- (device_ref, conversation_id); the new key is added first so the device foreign key always has an index.
-- chat_conversations gains browser_mode: how Saga and the user share this chat's browser ("ai" = AI only, Saga
-- drives and the user watches; "shared" = AI + me). NULL means the user's default (chat settings browserMode).
-- Deleting a conversation deletes its browser sessions and Saga tasks in the API (conversation ids are not foreign
-- keys here because '' marks the device-wide session); deleting the account still cascades through user_id.

ALTER TABLE browser_sessions
  ADD COLUMN conversation_id VARCHAR(64) NOT NULL DEFAULT '' AFTER device_ref;

ALTER TABLE browser_sessions
  ADD UNIQUE KEY uq_browser_session_chat (device_ref, conversation_id);

ALTER TABLE browser_sessions
  DROP INDEX uq_browser_session_device;

ALTER TABLE browser_sessions
  ADD KEY ix_browser_session_conv (user_id, conversation_id);

ALTER TABLE chat_conversations
  ADD COLUMN browser_mode VARCHAR(8) NULL AFTER model;

ALTER TABLE saga_tasks
  ADD COLUMN mode VARCHAR(8) NOT NULL DEFAULT 'ai' AFTER language;

ALTER TABLE saga_tasks
  ADD KEY ix_saga_task_conv (user_id, conversation_id);
