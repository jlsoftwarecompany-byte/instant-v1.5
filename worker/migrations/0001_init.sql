-- D1 migration: complete schema for Instant
-- Apply with: npx wrangler d1 migrations apply instant-db

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  push_subscription TEXT,
  links INTEGER DEFAULT 0,
  linker_avatar TEXT DEFAULT '👾',
  linker_color TEXT DEFAULT 'pink',
  password_hash TEXT,
  session_token TEXT,
  session_expires_at DATETIME
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_username TEXT NOT NULL,
  receiver_username TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_1 TEXT NOT NULL,
  participant_2 TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  conversation_started BOOLEAN DEFAULT 0,
  saved BOOLEAN DEFAULT 0,
  privacy_mode TEXT DEFAULT 'standard',
  disappear_after_seconds INTEGER,
  anonymous_mode INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  timer_type TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  content TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  timer_duration INTEGER NOT NULL,
  expired BOOLEAN DEFAULT 0,
  is_photo BOOLEAN DEFAULT 0,
  expires_at INTEGER,
  media_id INTEGER
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_username TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  encrypted_key TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_username TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '✨',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  member_username TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE(circle_id, member_username)
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_username TEXT NOT NULL,
  circle_id INTEGER,
  media_id INTEGER,
  caption TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS story_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  viewer_username TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  UNIQUE(story_id, viewer_username)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  event TEXT NOT NULL,
  props TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER DEFAULT 0
);
