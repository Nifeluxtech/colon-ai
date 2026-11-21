-- 0018 (v0.24.0): memory that remembers what the user shares. Additive only.
--
-- colon_memories.source  + 'auto': a personal fact Colon saved from a chat on its own ("My nickname is Elijah",
--                        "Always call me Elijah"), only while the user has memory on (modules/memory/facts.js).
-- colon_memories.kind    which fact a note holds ('name', 'nickname', 'call_me', 'home', 'school', 'job',
--                        'pref:<thing>', 'fav:<thing>'), or NULL for a free-form note. A newer note of the same kind
--                        replaces the older one instead of adding a second, so "call me Eli" after "call me Elijah"
--                        leaves one note. Notes saved before 0.24.0 keep NULL and are matched by their wording.
ALTER TABLE colon_memories
  MODIFY COLUMN source ENUM('settings','chat','auto') NOT NULL DEFAULT 'settings',
  ADD COLUMN kind VARCHAR(64) NULL AFTER source,
  ADD KEY ix_colon_memories_kind (user_id, kind);
