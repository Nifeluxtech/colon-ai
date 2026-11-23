-- 0025 (v0.30.0): published sites live at apparatus.name.ng/<username>/<site>/, so two users can both have a site
-- called "shop"; and a workspace can connect a sign-in / database service (Supabase, Firebase and others).
--
-- colon_site_owners             one publishing name per user (the <username> in every site link), picked on the
--                               first publish. Lowercase a-z, 0-9, hyphens, 3 to 30 characters.
-- colon_workspaces.slug         now unique per user instead of across everyone.
-- colon_workspace_connections   the public client settings of a service the site signs people in with or stores
--                               data in (a Supabase project URL and anon key, a Firebase web config...). These
--                               are meant to be public; private keys go in colon_workspace_secrets instead.
-- The ALTER runs first: the CREATEs after it are safe to repeat if a later statement fails.
ALTER TABLE colon_workspaces
  DROP INDEX ux_colon_workspaces_slug,
  ADD UNIQUE KEY ux_colon_workspaces_user_slug (user_id, slug);

CREATE TABLE IF NOT EXISTS colon_site_owners (
  user_id     BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  username    VARCHAR(30)     NOT NULL,
  created_at  DATETIME(3)     NOT NULL,
  UNIQUE KEY ux_colon_site_owners_username (username),
  CONSTRAINT fk_colon_site_owners_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_workspace_connections (
  workspace_id  VARCHAR(24)  NOT NULL,
  provider      VARCHAR(20)  NOT NULL,
  config        TEXT         NOT NULL,
  updated_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (workspace_id, provider),
  CONSTRAINT fk_colon_ws_conn_ws FOREIGN KEY (workspace_id) REFERENCES colon_workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
