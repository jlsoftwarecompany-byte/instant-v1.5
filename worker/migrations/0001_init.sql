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

-- =========================================================================
-- Performance indexes
-- =========================================================================

-- users: lookups by session_token (AUTH_LOGOUT, AUTH_VERIFY_SESSION)
CREATE INDEX IF NOT EXISTS idx_users_session_token ON users (session_token);

-- users: ORDER BY links DESC for discover-users feed
CREATE INDEX IF NOT EXISTS idx_users_links ON users (links DESC);

-- friendships: lookups by either participant
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_username);
CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON friendships (receiver_username);

-- conversations: lookups by either participant
CREATE INDEX IF NOT EXISTS idx_conversations_participant_1 ON conversations (participant_1);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_2 ON conversations (participant_2);

-- timers: JOIN / WHERE on conversation_id
CREATE INDEX IF NOT EXISTS idx_timers_conversation_id ON timers (conversation_id);

-- messages: filtered by conversation_id, ordered by sent_at
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_sent_at ON messages (conversation_id, sent_at);

-- messages: TTL sweep on expires_at
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at);

-- messages: bulk update of expired flag per conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation_expired ON messages (conversation_id, expired);

-- media: TTL sweep on expires_at
CREATE INDEX IF NOT EXISTS idx_media_expires_at ON media (expires_at);

-- circles: listing by owner, ordered by created_at DESC
CREATE INDEX IF NOT EXISTS idx_circles_owner_created ON circles (owner_username, created_at DESC);

-- circle_members: subquery SELECT circle_id WHERE member_username = ?
CREATE INDEX IF NOT EXISTS idx_circle_members_member ON circle_members (member_username);

-- stories: feed query filters on expires_at, author, circle_id; ordered by created_at DESC
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories (expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_author ON stories (author_username);
CREATE INDEX IF NOT EXISTS idx_stories_circle_id ON stories (circle_id);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories (created_at DESC);

-- analytics_events: filtered by username and event
CREATE INDEX IF NOT EXISTS idx_analytics_username ON analytics_events (username);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events (event);

-- refresh_tokens: lookup/revoke by username; TTL sweep on expires_at + revoked
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_username ON refresh_tokens (username);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_revoked ON refresh_tokens (expires_at, revoked);
