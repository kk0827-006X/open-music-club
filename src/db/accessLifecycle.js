function initializeAccessLifecycleSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_workflow (
      application_id INTEGER PRIMARY KEY REFERENCES access_requests(id),
      verified_at INTEGER, activated_at INTEGER, legacy_invited INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS access_tokens (
      id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES access_requests(id),
      purpose TEXT NOT NULL CHECK(purpose IN ('verify','activate')),
      digest TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access_mail_jobs (
      id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES access_requests(id),
      kind TEXT NOT NULL CHECK(kind IN ('verify','activate','admin','rejected')),
      token_id INTEGER REFERENCES access_tokens(id), ciphertext TEXT,
      status TEXT NOT NULL DEFAULT 'queued', subject TEXT NOT NULL UNIQUE,
      message_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS access_jobs_due ON access_mail_jobs(status,next_at);
    CREATE TABLE IF NOT EXISTS access_resend_limits (
      email_digest TEXT PRIMARY KEY, last_at INTEGER NOT NULL,
      window_at INTEGER NOT NULL, count INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO access_workflow(application_id, verified_at, activated_at)
      SELECT a.id, CASE WHEN a.status != 'pending' THEN 0 ELSE NULL END,
        CASE WHEN a.status = 'approved' AND EXISTS(SELECT 1 FROM users u WHERE u.email=a.email) THEN 0 ELSE NULL END
      FROM access_requests a;
  `)
}

module.exports = { initializeAccessLifecycleSchema }
