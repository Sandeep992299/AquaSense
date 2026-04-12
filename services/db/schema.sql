-- ============================================================
-- AquaSense Smart Utilities – PostgreSQL Database Schema
-- Compatible with Amazon Aurora PostgreSQL 15
-- Database: aquasense_db
-- Run: psql -U aqua_admin -d aquasense_db -f schema.sql
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'residential'
                  CHECK (role IN ('residential','commercial','admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Smart Meters ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meters (
  id           VARCHAR(20)  PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(10)  NOT NULL CHECK (type IN ('water','energy')),
  location     VARCHAR(200),
  status       VARCHAR(10)  NOT NULL DEFAULT 'online'
                 CHECK (status IN ('online','offline','warning')),
  mqtt_topic   VARCHAR(100),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Meter Readings (IoT telemetry – mirrors DynamoDB SmartMeterData) ──
CREATE TABLE IF NOT EXISTS meter_readings (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id    VARCHAR(20)  NOT NULL REFERENCES meters(id),
  user_id     UUID         NOT NULL REFERENCES users(id),
  type        VARCHAR(10)  NOT NULL CHECK (type IN ('water','energy')),
  value       NUMERIC(10,3) NOT NULL,
  unit        VARCHAR(10),
  pressure    NUMERIC(5,2),
  quality     VARCHAR(10)  NOT NULL DEFAULT 'normal'
                CHECK (quality IN ('normal','anomaly')),
  mqtt_topic  VARCHAR(100),
  recorded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_readings_meter    ON meter_readings(meter_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_user     ON meter_readings(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_type     ON meter_readings(type, recorded_at DESC);

-- ── Tariff Rates (no hardcoded values – pulled from DB) ──────
CREATE TABLE IF NOT EXISTS tariff_rates (
  id             SERIAL      PRIMARY KEY,
  resource_type  VARCHAR(10) NOT NULL CHECK (resource_type IN ('water','energy','fixed')),
  rate_per_unit  NUMERIC(10,4) NOT NULL,
  unit           VARCHAR(20),
  currency       VARCHAR(5)  NOT NULL DEFAULT 'INR',
  effective_from DATE        NOT NULL DEFAULT CURRENT_DATE,
  active         BOOLEAN     NOT NULL DEFAULT TRUE
);

-- ── Bills ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id),
  month         CHAR(7)     NOT NULL,           -- e.g. '2026-04'
  water_litres  NUMERIC(10,2) NOT NULL DEFAULT 0,
  energy_kwh    NUMERIC(10,2) NOT NULL DEFAULT 0,
  water_cost    NUMERIC(10,2) NOT NULL DEFAULT 0,
  energy_cost   NUMERIC(10,2) NOT NULL DEFAULT 0,
  fixed_charge  NUMERIC(10,2) NOT NULL DEFAULT 0,
  total         NUMERIC(10,2) NOT NULL,
  currency      VARCHAR(5)  NOT NULL DEFAULT 'INR',
  status        VARCHAR(10) NOT NULL DEFAULT 'unpaid'
                  CHECK (status IN ('unpaid','paid','overdue')),
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date      TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  UNIQUE(user_id, month)
);

-- ── Payments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID        NOT NULL REFERENCES bills(id),
  user_id         UUID        NOT NULL REFERENCES users(id),
  amount          NUMERIC(10,2) NOT NULL,
  method          VARCHAR(20),
  transaction_ref VARCHAR(100),
  status          VARCHAR(10) NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success','failed','pending')),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(20) NOT NULL,
  severity      VARCHAR(10) NOT NULL CHECK (severity IN ('critical','warning','info')),
  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  meter_id      VARCHAR(20) REFERENCES meters(id),
  user_id       UUID        REFERENCES users(id),
  status        VARCHAR(10) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','resolved')),
  sns_published BOOLEAN     NOT NULL DEFAULT FALSE,
  sns_topic     VARCHAR(200),
  sqs_queue     VARCHAR(100),
  resolved_by   VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_user   ON alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, severity);

-- ── Alert Subscriptions (SNS subscriber simulation) ──────────
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol   VARCHAR(20) NOT NULL CHECK (protocol IN ('email','sms','lambda','sqs','http')),
  endpoint   VARCHAR(200) NOT NULL,
  topic      VARCHAR(100) NOT NULL DEFAULT 'asu-alerts',
  confirmed  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trigger: auto-update updated_at on users ─────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
