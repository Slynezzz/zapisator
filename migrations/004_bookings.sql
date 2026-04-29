CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  telegram_user_id TEXT,
  max_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id, phone)
);

CREATE TABLE IF NOT EXISTS master_services (
  id BIGSERIAL PRIMARY KEY,
  master_id BIGINT NOT NULL REFERENCES masters(id),
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  master_id BIGINT NOT NULL REFERENCES masters(id),
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  service_id BIGINT NOT NULL REFERENCES master_services(id),
  slot_id BIGINT NOT NULL REFERENCES master_slots(id),
  booking_status TEXT NOT NULL CHECK (booking_status IN ('pending', 'awaiting_payment', 'confirmed', 'cancelled', 'completed')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  source_channel TEXT NOT NULL CHECK (source_channel IN ('telegram', 'max', 'web')),
  client_external_user_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_master ON bookings(master_id, created_at DESC);
