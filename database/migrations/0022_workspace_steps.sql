-- 0022 (v0.27.2): live steps in the Workspace chat, and talking to Colon while it builds. Additive only.
--
-- colon_workspace_messages.steps  JSON [{ label, state: 'run'|'done'|'fail', start, ms?, detail? }]: what Colon
--                                 is doing for this message (reading files, asking the model, writing each file,
--                                 saving the version). Written to the user's message while the reply runs, so any
--                                 API process can answer the app's poll, and copied to the reply when it lands.
-- colon_workspace_messages.kind   what a message is to the build queue, so the user can keep talking while Colon
--                                 builds. User messages: 'running' (being built now), 'queued' (a change asked for
--                                 mid-build, built next), 'done' (built or failed), 'side' (a question asked
--                                 mid-build, answered at once without touching files). Colon's quick answer to a
--                                 'side' or 'queued' message is an assistant row with kind 'side'. NULL = older rows.
ALTER TABLE colon_workspace_messages ADD COLUMN steps TEXT NULL, ADD COLUMN kind VARCHAR(10) NULL;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0022_workspace_steps');
