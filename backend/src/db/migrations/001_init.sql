-- Medinity Connect schema. Idempotent (IF NOT EXISTS) so migrate can run on every boot.

CREATE SEQUENCE IF NOT EXISTS case_human_seq START 1042;

CREATE TABLE IF NOT EXISTS patients (
  wa_phone   TEXT PRIMARY KEY,
  name       TEXT,
  lang       TEXT,
  notes      TEXT,
  created_at BIGINT
);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS notes TEXT;

-- patient log-book entries (visits, hospitalisations, notes added by staff)
CREATE TABLE IF NOT EXISTS patient_records (
  id       BIGSERIAL PRIMARY KEY,
  wa_phone TEXT,
  kind     TEXT,
  note     TEXT,
  author   TEXT,
  at       BIGINT
);
CREATE INDEX IF NOT EXISTS idx_records_phone ON patient_records (wa_phone);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  login         TEXT UNIQUE,
  role          TEXT,
  team_id       TEXT,
  password_hash TEXT,
  phone         TEXT,
  hours         TEXT,
  on_leave      BOOLEAN DEFAULT FALSE,
  active        BOOLEAN DEFAULT TRUE
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hours TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS on_leave BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS shifts (
  id               BIGSERIAL PRIMARY KEY,
  user_id          TEXT,
  date             TEXT,
  start_time       TEXT,
  end_time         TEXT,
  weekly_leave_day TEXT,
  at               BIGINT,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS sessions (
  wa_phone         TEXT PRIMARY KEY,
  journey          TEXT,
  step             TEXT,
  lang             TEXT,
  state            JSONB,
  last_activity_at BIGINT,
  expires_at       BIGINT
);

CREATE TABLE IF NOT EXISTS teams (
  id   TEXT PRIMARY KEY,
  name TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  en           TEXT,
  hi           TEXT,
  team         TEXT,
  eta_min      INT,
  journey_type TEXT
);

CREATE TABLE IF NOT EXISTS doctors (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  department TEXT,
  active     BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS slots (
  id           TEXT PRIMARY KEY,
  doctor_id    TEXT,
  label        TEXT,
  start_at     TEXT,
  capacity     INT,
  booked_count INT DEFAULT 0,
  status       TEXT DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS cases (
  id          BIGSERIAL PRIMARY KEY,
  human_no    TEXT,
  type        TEXT,
  category_id TEXT,
  patient_wa  TEXT,
  team_id     TEXT,
  assignee_id TEXT,
  status      TEXT,
  room_bed    TEXT,
  description TEXT,
  eta_min     INT,
  eta_at      BIGINT,
  sla_due_at  BIGINT,
  rating      INT,
  feedback    TEXT,
  booking_id  BIGINT,
  created_at  BIGINT,
  resolved_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_cases_team ON cases (team_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);

CREATE TABLE IF NOT EXISTS case_events (
  id      BIGSERIAL PRIMARY KEY,
  case_id BIGINT,
  actor   TEXT,
  type    TEXT,
  payload JSONB,
  at      BIGINT
);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events (case_id);

CREATE TABLE IF NOT EXISTS attachments (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT,
  url         TEXT,
  wa_media_id TEXT,
  kind        TEXT,
  at          BIGINT
);

CREATE TABLE IF NOT EXISTS bookings (
  id              BIGSERIAL PRIMARY KEY,
  slot_id         TEXT,
  doctor_id       TEXT,
  patient_wa      TEXT,
  case_id         BIGINT,
  status          TEXT,
  hold_expires_at BIGINT,
  cancel_reason   TEXT,
  visited_at      BIGINT,
  is_revisit      BOOLEAN DEFAULT FALSE,
  created_at      BIGINT
);
-- lifecycle columns for existing databases (idempotent)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS visited_at BIGINT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_revisit BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS messages (
  id           BIGSERIAL PRIMARY KEY,
  wa_phone     TEXT,
  direction    TEXT,
  body         TEXT,
  reply_id     TEXT,
  template_key TEXT,
  agent        TEXT,
  case_id      BIGINT,
  at           BIGINT
);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages (wa_phone);
