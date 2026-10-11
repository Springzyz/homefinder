-- HomeFinder email queue. Timestamps are Unix epoch seconds (UTC).
-- Status model: pending -> processed | retryable_error -> processed | quarantined
CREATE TABLE email_messages (
  id TEXT PRIMARY KEY,                       -- random UUID, the only id the consumer ever sees
  idempotency_key TEXT NOT NULL UNIQUE,      -- sha256 of Message-ID + sender + subject + body hashes
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  received_at INTEGER NOT NULL,
  text_body TEXT,                            -- bounded, scrubbed after retention
  html_body TEXT,                            -- bounded, untrusted, never rendered; scrubbed after retention
  portal_hint TEXT CHECK (portal_hint IN ('imovirtual', 'supercasa')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'retryable_error', 'quarantined')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,                           -- short machine code only, never content
  updated_at INTEGER NOT NULL,
  payload_scrubbed_at INTEGER
);
CREATE INDEX idx_email_status_received ON email_messages (status, received_at);
CREATE INDEX idx_email_updated ON email_messages (updated_at);
