DROP INDEX IF EXISTS shares_expiry;
CREATE TABLE shares_unlimited (
  id TEXT PRIMARY KEY,
  report TEXT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  password_salt TEXT,
  password_hash TEXT
);
INSERT INTO shares_unlimited SELECT id, report, title, created_at, expires_at, revoked_at, password_salt, password_hash FROM shares;
DROP TABLE shares;
ALTER TABLE shares_unlimited RENAME TO shares;
CREATE INDEX shares_expiry ON shares(expires_at);
CREATE INDEX shares_created ON shares(created_at DESC);
