CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  report TEXT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  password_salt TEXT,
  password_hash TEXT
);
CREATE INDEX IF NOT EXISTS shares_expiry ON shares(expires_at);
CREATE INDEX IF NOT EXISTS shares_created ON shares(created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
