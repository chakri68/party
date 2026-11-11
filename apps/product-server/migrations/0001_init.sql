CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE login_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, next TEXT, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE entitlements (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('razorpay','paddle','comp','grant')), plan TEXT NOT NULL,
  starts_at INTEGER NOT NULL, ends_at INTEGER, ref TEXT, revoked_at INTEGER, UNIQUE (user_id, source, ref));
CREATE TABLE comp_codes (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, days INTEGER, max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0, note TEXT, created_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE TABLE rooms (code TEXT PRIMARY KEY, tier TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX rooms_recent ON rooms (created_at);
