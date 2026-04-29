CREATE TABLE IF NOT EXISTS outbox_messages (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'max')),
  recipient_external_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  dedupe_key TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedupe_key ON outbox_messages(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_messages(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS outbox_attempts (
  id BIGSERIAL PRIMARY KEY,
  outbox_message_id BIGINT NOT NULL REFERENCES outbox_messages(id),
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMPTZ;
