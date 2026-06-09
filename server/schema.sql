CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
