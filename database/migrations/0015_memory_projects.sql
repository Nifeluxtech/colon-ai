-- 0015 (v0.15.0, Blueprint step B, items 9 and 10): memory and projects. Additive only.
--
-- colon_projects         a user's projects: a name and standing instructions for every chat in it. How many a user
--                        may have comes from the plan entitlement 'projects' (plan_entitlements, 0012).
-- colon_memories         what Colon remembers about a user, written or approved by the user only (no model-made
--                        memories). scope: user (every chat), project (chats in project_id), task (one chat,
--                        conversation_id). Deleting is a hard DELETE (nothing is kept), and deleting a user, a
--                        project or a chat deletes its memories with it (ON DELETE CASCADE).
-- colon_memory_consent   one row per user who has chosen. No row = memory OFF (opt-in): nothing is saved from chat
--                        and nothing is added to the model's context until the user turns it on.
-- chat_conversations.project_id, chat_attachments.project_id: chats and files in a project. Deleting a project
--                        keeps them and moves them out of it (ON DELETE SET NULL).
CREATE TABLE IF NOT EXISTS colon_projects (
  id            VARCHAR(24)     NOT NULL PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(80)     NOT NULL,
  instructions  TEXT            NULL,
  created_at    DATETIME(3)     NOT NULL,
  updated_at    DATETIME(3)     NOT NULL,
  KEY ix_colon_projects_user (user_id, updated_at),
  CONSTRAINT fk_colon_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_memories (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  project_id      VARCHAR(24)     NULL,
  conversation_id VARCHAR(24)     NULL,
  scope           ENUM('user','project','task') NOT NULL DEFAULT 'user',
  content         VARCHAR(1000)   NOT NULL,
  source          ENUM('settings','chat') NOT NULL DEFAULT 'settings',
  created_at      DATETIME(3)     NOT NULL,
  updated_at      DATETIME(3)     NOT NULL,
  KEY ix_colon_memories_user (user_id, updated_at),
  KEY ix_colon_memories_project (project_id),
  KEY ix_colon_memories_conv (conversation_id),
  CONSTRAINT fk_colon_memories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_colon_memories_project FOREIGN KEY (project_id) REFERENCES colon_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_colon_memories_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colon_memory_consent (
  user_id     BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled     TINYINT(1)      NOT NULL DEFAULT 0,
  changed_at  DATETIME(3)     NOT NULL,
  CONSTRAINT fk_colon_memory_consent_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE chat_conversations
  ADD COLUMN project_id VARCHAR(24) NULL AFTER user_id,
  ADD KEY ix_chat_conv_project (project_id, updated_at),
  ADD CONSTRAINT fk_chat_conv_project FOREIGN KEY (project_id) REFERENCES colon_projects(id) ON DELETE SET NULL;

ALTER TABLE chat_attachments
  ADD COLUMN project_id VARCHAR(24) NULL AFTER user_id,
  ADD KEY ix_chat_att_project (project_id),
  ADD CONSTRAINT fk_chat_att_project FOREIGN KEY (project_id) REFERENCES colon_projects(id) ON DELETE SET NULL;

INSERT IGNORE INTO schema_migrations (id) VALUES ('0015_memory_projects');
