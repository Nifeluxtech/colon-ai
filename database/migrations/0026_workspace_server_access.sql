-- 0026 (v0.31.0): a workspace connection can give Colon server access, so the Workspace chat can work in the
-- connected database itself and commit, push and merge to a connected GitHub or Bitbucket repository.
--
-- colon_workspace_connections.secret_enc   the private credentials as JSON (a Supabase service_role key and optional
--                                          personal access token, a Firebase service account, an Appwrite API key,
--                                          a PocketBase superuser login, a GitHub / Bitbucket token), encrypted with
--                                          AES-256-GCM from APP_SECRET (shared/crypto.js). Never returned by the API
--                                          and never reachable from a published site (unlike colon_workspace_secrets,
--                                          which the public /sites/:key/call proxy uses).
-- colon_workspace_connections.state        JSON Colon keeps about the connection: for Git the last commit (sha,
--                                          message, time, link) and the paths it pushed, so files deleted in the
--                                          workspace are deleted in the repository on the next push.
-- Connections stay per workspace: they apply to everything in that workspace and go when it is deleted.
ALTER TABLE colon_workspace_connections
  ADD COLUMN secret_enc TEXT NULL AFTER config,
  ADD COLUMN state      MEDIUMTEXT NULL AFTER secret_enc;
