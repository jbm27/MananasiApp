CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_state_history (
  history_id BIGSERIAL PRIMARY KEY,
  state_id TEXT NOT NULL,
  change_source TEXT NOT NULL DEFAULT 'api',
  expected_updated_at TIMESTAMPTZ,
  previous_updated_at TIMESTAMPTZ,
  next_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_state_history_state_created
  ON app_state_history (state_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attendance_events (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in', 'clock_out')),
  occurred_at TIMESTAMPTZ NOT NULL,
  device_id TEXT,
  source_event_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance_events (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_occurred ON attendance_events (occurred_at DESC);
