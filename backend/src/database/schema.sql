PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('private', 'group')),
  name TEXT,
  private_pair_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK (
    (kind = 'group' AND name IS NOT NULL AND private_pair_key IS NULL)
    OR (kind = 'private' AND name IS NULL AND private_pair_key IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS memberships (
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  visible_from_seq INTEGER NOT NULL CHECK (visible_from_seq >= 0),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
  sender_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  client_message_id TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  UNIQUE (sender_id, client_message_id)
) STRICT;

CREATE TABLE IF NOT EXISTS login_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS message_emojis (
  seq INTEGER PRIMARY KEY,
  emoji_id TEXT NOT NULL UNIQUE,
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (message_id, emoji)
) STRICT;

CREATE INDEX IF NOT EXISTS messages_by_room_seq
  ON messages (room_id, seq);

CREATE INDEX IF NOT EXISTS login_sessions_by_expiry
  ON login_sessions (expires_at);
