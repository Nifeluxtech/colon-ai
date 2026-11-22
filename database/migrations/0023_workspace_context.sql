-- 0023 (v0.28.0): what Colon knows about a workspace beyond its files. Additive only.
--
-- colon_workspaces.instructions  the user's standing instructions for this site ("use Tailwind", "keep it in
--                                French"), sent with every build. NULL = none.
-- colon_workspaces.ref_url       a repository Colon learns from ("Learn from a repository"): its address,
--             .ref_text          the key files read from it (README, pages, styles, scripts; about 40 KB of text),
--             .ref_files         and how many files that text holds. Colon follows its structure and style when
--                                building; nothing is copied into the site unless the user asks.
ALTER TABLE colon_workspaces
  ADD COLUMN instructions TEXT NULL,
  ADD COLUMN ref_url VARCHAR(500) NULL,
  ADD COLUMN ref_text MEDIUMTEXT NULL,
  ADD COLUMN ref_files INT UNSIGNED NULL;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0023_workspace_context');
