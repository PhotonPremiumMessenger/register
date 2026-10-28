-- NEXO Messenger — initial relational schema
-- Applied automatically on server start (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT,
  google_id             TEXT UNIQUE,
  reset_token_hash      TEXT,
  reset_token_expires_at TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  uploader_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'message'
               CHECK (kind IN ('avatar','group_avatar','channel_avatar','message')),
  file_name    TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username             TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  bio                  TEXT NOT NULL DEFAULT '',
  avatar_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  last_seen_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme                TEXT NOT NULL DEFAULT 'obsidian'
                       CHECK (theme IN ('obsidian','midnight','black')),
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  notification_sound   INTEGER NOT NULL DEFAULT 1,
  show_online_status   INTEGER NOT NULL DEFAULT 1,
  allow_messages_from  TEXT NOT NULL DEFAULT 'everyone'
                       CHECK (allow_messages_from IN ('everyone','nobody'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id               TEXT PRIMARY KEY,
  user_a_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_activity_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TEXT,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  is_public            INTEGER NOT NULL DEFAULT 0,
  owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avatar_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_read_at TEXT,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  is_public            INTEGER NOT NULL DEFAULT 1,
  owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avatar_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'subscriber' CHECK (role IN ('owner','admin','subscriber')),
  joined_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_read_at TEXT,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  group_id        TEXT REFERENCES groups(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL DEFAULT '',
  attachment_id   TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((conversation_id IS NULL) <> (group_id IS NULL)),
  CHECK (content <> '' OR attachment_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS channel_posts (
  id            TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL DEFAULT '',
  attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (content <> '' OR attachment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation   ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_group          ON messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_posts_channel   ON channel_posts(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_attachment     ON messages(attachment_id);
CREATE INDEX IF NOT EXISTS idx_posts_attachment        ON channel_posts(attachment_id);
CREATE INDEX IF NOT EXISTS idx_conv_members_user       ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user      ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_user    ON channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_activity  ON conversations(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_username       ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader    ON attachments(uploader_id);
