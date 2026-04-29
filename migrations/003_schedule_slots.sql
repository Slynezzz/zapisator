CREATE TABLE IF NOT EXISTS working_hours (
  id BIGSERIAL PRIMARY KEY,
  master_id BIGINT NOT NULL REFERENCES masters(id),
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(master_id, weekday),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS master_slots (
  id BIGSERIAL PRIMARY KEY,
  master_id BIGINT NOT NULL REFERENCES masters(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'reserved', 'blocked', 'closed')),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_master_slots_master_start ON master_slots(master_id, start_at);
CREATE INDEX IF NOT EXISTS idx_master_slots_status ON master_slots(status);
