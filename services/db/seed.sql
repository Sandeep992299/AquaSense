-- ============================================================
-- AquaSense – Seed Data  (v2 – Full with Readings, Bills, Payments)
-- Run AFTER schema.sql
-- psql -U aqua_admin -d aquasense_db -f seed.sql
-- ============================================================

-- ── Tariff Rates ─────────────────────────────────────────────
-- LKR rates aligned with portal UI display
INSERT INTO tariff_rates (resource_type, rate_per_unit, unit, currency, effective_from, active) VALUES
  ('water',  0.09,   'per litre', 'LKR', '2026-01-01', TRUE),
  ('energy', 8.50,   'per kWh',   'LKR', '2026-01-01', TRUE),
  ('fixed',  180.00, 'monthly',   'LKR', '2026-01-01', TRUE)
ON CONFLICT DO NOTHING;

-- ── Demo Users ────────────────────────────────────────────────
-- Password for all users: password123  (bcrypt hash below)
INSERT INTO users (id, name, email, password_hash, role) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Rajesh Kumar',  'rajesh@aquasense.in',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'residential'),
  ('a0000001-0000-0000-0000-000000000002', 'Priya Nair',    'priya@aquasense.in',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'commercial'),
  ('a0000001-0000-0000-0000-000000000003', 'Admin User',    'admin@aquasense.in',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
ON CONFLICT (email) DO NOTHING;

-- ── Smart Meters ─────────────────────────────────────────────
INSERT INTO meters (id, user_id, type, location, status, mqtt_topic) VALUES
  ('SMT-W-0041', 'a0000001-0000-0000-0000-000000000001', 'water',  'Kitchen Block, Unit A', 'online',  'smartmeter/water/usage'),
  ('SMT-W-0042', 'a0000001-0000-0000-0000-000000000001', 'water',  'Garden Zone South',     'online',  'smartmeter/water/usage'),
  ('SMT-E-0087', 'a0000001-0000-0000-0000-000000000001', 'energy', 'Distribution Board',    'online',  'smartmeter/energy/usage'),
  ('SMT-W-0043', 'a0000001-0000-0000-0000-000000000002', 'water',  'Factory Main Supply',   'warning', 'smartmeter/water/usage'),
  ('SMT-E-0088', 'a0000001-0000-0000-0000-000000000002', 'energy', 'HVAC Unit',             'online',  'smartmeter/energy/usage'),
  ('SMT-W-0044', 'a0000001-0000-0000-0000-000000000002', 'water',  'Backup Supply',         'offline', 'smartmeter/water/leakage')
ON CONFLICT (id) DO NOTHING;

-- ── Meter Readings – Last 30 days (Rajesh Kumar) ─────────────
-- We generate hourly-ish readings per day using generate_series
-- Water: SMT-W-0041 (Kitchen) – avg 180 L/day
INSERT INTO meter_readings (meter_id, user_id, type, value, unit, pressure, quality, recorded_at)
SELECT
  'SMT-W-0041',
  'a0000001-0000-0000-0000-000000000001',
  'water',
  ROUND((140 + RANDOM() * 80)::numeric, 3),           -- 140–220 L per reading
  'L',
  ROUND((2.1 + RANDOM() * 0.6)::numeric, 2),          -- 2.1–2.7 bar pressure
  CASE WHEN RANDOM() < 0.04 THEN 'anomaly' ELSE 'normal' END,
  ts
FROM generate_series(
  NOW() - INTERVAL '30 days',
  NOW(),
  INTERVAL '4 hours'                                  -- 6 readings/day
) AS ts
ON CONFLICT DO NOTHING;

-- Water: SMT-W-0042 (Garden) – avg 90 L/day
INSERT INTO meter_readings (meter_id, user_id, type, value, unit, pressure, quality, recorded_at)
SELECT
  'SMT-W-0042',
  'a0000001-0000-0000-0000-000000000001',
  'water',
  ROUND((60 + RANDOM() * 60)::numeric, 3),            -- 60–120 L
  'L',
  ROUND((1.8 + RANDOM() * 0.5)::numeric, 2),          -- 1.8–2.3 bar
  CASE WHEN RANDOM() < 0.02 THEN 'anomaly' ELSE 'normal' END,
  ts
FROM generate_series(
  NOW() - INTERVAL '30 days',
  NOW(),
  INTERVAL '6 hours'                                  -- 4 readings/day
) AS ts
ON CONFLICT DO NOTHING;

-- Energy: SMT-E-0087 (Distribution Board) – avg 14 kWh/day
INSERT INTO meter_readings (meter_id, user_id, type, value, unit, quality, recorded_at)
SELECT
  'SMT-E-0087',
  'a0000001-0000-0000-0000-000000000001',
  'energy',
  ROUND((10 + RANDOM() * 8)::numeric, 3),             -- 10–18 kWh per reading
  'kWh',
  CASE WHEN RANDOM() < 0.03 THEN 'anomaly' ELSE 'normal' END,
  ts
FROM generate_series(
  NOW() - INTERVAL '30 days',
  NOW(),
  INTERVAL '6 hours'                                  -- 4 readings/day
) AS ts
ON CONFLICT DO NOTHING;

-- Water readings for Priya Nair (commercial – higher consumption)
INSERT INTO meter_readings (meter_id, user_id, type, value, unit, pressure, quality, recorded_at)
SELECT
  'SMT-W-0043',
  'a0000001-0000-0000-0000-000000000002',
  'water',
  ROUND((300 + RANDOM() * 200)::numeric, 3),          -- 300–500 L (factory)
  'L',
  ROUND((3.0 + RANDOM() * 1.0)::numeric, 2),          -- 3.0–4.0 bar
  CASE WHEN RANDOM() < 0.06 THEN 'anomaly' ELSE 'normal' END,
  ts
FROM generate_series(
  NOW() - INTERVAL '30 days',
  NOW(),
  INTERVAL '3 hours'
) AS ts
ON CONFLICT DO NOTHING;

INSERT INTO meter_readings (meter_id, user_id, type, value, unit, quality, recorded_at)
SELECT
  'SMT-E-0088',
  'a0000001-0000-0000-0000-000000000002',
  'energy',
  ROUND((40 + RANDOM() * 30)::numeric, 3),            -- 40–70 kWh (HVAC)
  'kWh',
  CASE WHEN RANDOM() < 0.03 THEN 'anomaly' ELSE 'normal' END,
  ts
FROM generate_series(
  NOW() - INTERVAL '30 days',
  NOW(),
  INTERVAL '4 hours'
) AS ts
ON CONFLICT DO NOTHING;

-- ── Bills – Rajesh Kumar (6 months history) ───────────────────
-- Month data derived from realistic consumption × tariff rates
-- water_cost  = water_litres × 0.09
-- energy_cost = energy_kwh   × 8.50
-- fixed_charge = 180.00
INSERT INTO bills
  (id, user_id, month, water_litres, energy_kwh,
   water_cost, energy_cost, fixed_charge, total, currency, status, issued_at, due_date, paid_at)
VALUES
  -- Dec 2025 – paid
  ('b1000001-0000-0000-0000-000000000001',
   'a0000001-0000-0000-0000-000000000001',
   '2025-12', 9100, 488,
   819.00, 4148.00, 180.00, 5147.00,
   'LKR', 'paid',
   '2026-01-01 09:00:00+00',
   '2026-01-15 00:00:00+00',
   '2026-01-10 14:22:00+00'),

  -- Jan 2026 – paid
  ('b1000001-0000-0000-0000-000000000002',
   'a0000001-0000-0000-0000-000000000001',
   '2026-01', 8400, 445,
   756.00, 3782.50, 180.00, 4718.50,
   'LKR', 'paid',
   '2026-02-01 09:00:00+00',
   '2026-02-15 00:00:00+00',
   '2026-02-08 11:05:00+00'),

  -- Feb 2026 – paid
  ('b1000001-0000-0000-0000-000000000003',
   'a0000001-0000-0000-0000-000000000001',
   '2026-02', 7500, 421,
   675.00, 3578.50, 180.00, 4433.50,
   'LKR', 'paid',
   '2026-03-01 09:00:00+00',
   '2026-03-15 00:00:00+00',
   '2026-03-07 16:48:00+00'),

  -- Mar 2026 – overdue (due date passed, not paid)
  ('b1000001-0000-0000-0000-000000000004',
   'a0000001-0000-0000-0000-000000000001',
   '2026-03', 6900, 435,
   621.00, 3697.50, 180.00, 4498.50,
   'LKR', 'overdue',
   '2026-04-01 09:00:00+00',
   '2026-04-15 00:00:00+00',
   NULL),

  -- Apr 2026 – paid
  ('b1000001-0000-0000-0000-000000000005',
   'a0000001-0000-0000-0000-000000000001',
   '2026-04', 8100, 398,
   729.00, 3383.00, 180.00, 4292.00,
   'LKR', 'paid',
   '2026-05-01 09:00:00+00',
   '2026-05-15 00:00:00+00',
   '2026-05-09 09:30:00+00'),

  -- May 2026 – unpaid (current due)
  ('b1000001-0000-0000-0000-000000000006',
   'a0000001-0000-0000-0000-000000000001',
   '2026-05', 7200, 412,
   648.00, 3502.00, 180.00, 4330.00,
   'LKR', 'unpaid',
   '2026-06-01 09:00:00+00',
   '2026-06-15 00:00:00+00',
   NULL)
ON CONFLICT (user_id, month) DO NOTHING;

-- Bills for Priya Nair (commercial – higher usage)
INSERT INTO bills
  (id, user_id, month, water_litres, energy_kwh,
   water_cost, energy_cost, fixed_charge, total, currency, status, issued_at, due_date, paid_at)
VALUES
  ('b2000001-0000-0000-0000-000000000001',
   'a0000001-0000-0000-0000-000000000002',
   '2026-04', 28000, 1820,
   2520.00, 15470.00, 180.00, 18170.00,
   'LKR', 'paid',
   '2026-05-01 09:00:00+00',
   '2026-05-15 00:00:00+00',
   '2026-05-12 10:00:00+00'),

  ('b2000001-0000-0000-0000-000000000002',
   'a0000001-0000-0000-0000-000000000002',
   '2026-05', 31000, 1940,
   2790.00, 16490.00, 180.00, 19460.00,
   'LKR', 'unpaid',
   '2026-06-01 09:00:00+00',
   '2026-06-15 00:00:00+00',
   NULL)
ON CONFLICT (user_id, month) DO NOTHING;

-- ── Payments – Rajesh Kumar ───────────────────────────────────
INSERT INTO payments (id, bill_id, user_id, amount, method, transaction_ref, status, paid_at)
VALUES
  ('99000001-0000-0000-0000-000000000001',
   'b1000001-0000-0000-0000-000000000001',
   'a0000001-0000-0000-0000-000000000001',
   5147.00, 'UPI', 'UPI20260110RAJESH001', 'success',
   '2026-01-10 14:22:00+00'),

  ('99000001-0000-0000-0000-000000000002',
   'b1000001-0000-0000-0000-000000000002',
   'a0000001-0000-0000-0000-000000000001',
   4718.50, 'NET_BANKING', 'NB20260208RAJESH002', 'success',
   '2026-02-08 11:05:00+00'),

  ('99000001-0000-0000-0000-000000000003',
   'b1000001-0000-0000-0000-000000000003',
   'a0000001-0000-0000-0000-000000000001',
   4433.50, 'UPI', 'UPI20260307RAJESH003', 'success',
   '2026-03-07 16:48:00+00'),

  ('99000001-0000-0000-0000-000000000004',
   'b1000001-0000-0000-0000-000000000005',
   'a0000001-0000-0000-0000-000000000001',
   4292.00, 'UPI', 'UPI20260509RAJESH004', 'success',
   '2026-05-09 09:30:00+00')
ON CONFLICT DO NOTHING;

-- Payment for Priya
INSERT INTO payments (id, bill_id, user_id, amount, method, transaction_ref, status, paid_at)
VALUES
  ('99000002-0000-0000-0000-000000000001',
   'b2000001-0000-0000-0000-000000000001',
   'a0000001-0000-0000-0000-000000000002',
   18170.00, 'NET_BANKING', 'NB20260512PRIYA001', 'success',
   '2026-05-12 10:00:00+00')
ON CONFLICT DO NOTHING;

-- ── Alert Subscriptions ──────────────────────────────────────
INSERT INTO alert_subscriptions (protocol, endpoint, topic, confirmed) VALUES
  ('email',  'admin@aquasense.in',  'asu-alerts', TRUE),
  ('sms',    '+91-9876543210',      'asu-alerts', TRUE),
  ('lambda', 'arn:aws:lambda:ap-south-1:123456789012:function:alert-dispatcher', 'asu-alerts', TRUE)
ON CONFLICT DO NOTHING;

-- ── Alerts ───────────────────────────────────────────────────
-- Active alerts for Rajesh (residential)
INSERT INTO alerts (type, severity, title, description, meter_id, user_id, status, sns_published, sns_topic, sqs_queue, created_at)
SELECT 'leakage', 'critical',
  'Leakage Detected – Kitchen (SMT-W-0041)',
  'Flow sensor SMT-W-0041 registered sustained flow of 0.4 L/hr at 02:45 AM with no taps open. Possible pipe leak at Kitchen Block, Unit A.',
  'SMT-W-0041', 'a0000001-0000-0000-0000-000000000001',
  'active', TRUE, 'asu-alerts', 'alert-processing-queue',
  NOW() - INTERVAL '2 hours'
WHERE NOT EXISTS (
  SELECT 1 FROM alerts WHERE meter_id='SMT-W-0041' AND type='leakage' AND status='active'
);

INSERT INTO alerts (type, severity, title, description, meter_id, user_id, status, sns_published, sns_topic, sqs_queue, created_at)
SELECT 'high_consumption', 'warning',
  'High Water Consumption – Garden Zone',
  'SMT-W-0042 usage exceeded daily baseline by 140%. Current reading: 186 L (baseline: 90 L/day). Possible irrigation system fault.',
  'SMT-W-0042', 'a0000001-0000-0000-0000-000000000001',
  'active', TRUE, 'asu-alerts', 'alert-processing-queue',
  NOW() - INTERVAL '18 hours'
WHERE NOT EXISTS (
  SELECT 1 FROM alerts WHERE meter_id='SMT-W-0042' AND type='high_consumption' AND status='active'
);

INSERT INTO alerts (type, severity, title, description, meter_id, user_id, status, sns_published, sns_topic, sqs_queue, created_at)
SELECT 'billing', 'info',
  'Monthly Bill Generated – May 2026',
  'Your bill for May 2026 has been generated: LKR 4,330.00. Due date: 15 Jun 2026. Water: 7,200 L · Energy: 412 kWh.',
  NULL, 'a0000001-0000-0000-0000-000000000001',
  'active', FALSE, 'asu-alerts', 'alert-processing-queue',
  NOW() - INTERVAL '4 days'
WHERE NOT EXISTS (
  SELECT 1 FROM alerts WHERE type='billing' AND user_id='a0000001-0000-0000-0000-000000000001' AND status='active'
);

-- Resolved alert (historical)
INSERT INTO alerts (type, severity, title, description, meter_id, user_id, status, sns_published, sns_topic, sqs_queue, created_at, resolved_at, resolved_by)
SELECT 'pressure_drop', 'warning',
  'Low Pressure Detected – Kitchen Block',
  'Pressure at SMT-W-0041 dropped to 1.2 bar (threshold: 1.5 bar). Investigated and resolved – airlock cleared.',
  'SMT-W-0041', 'a0000001-0000-0000-0000-000000000001',
  'resolved', TRUE, 'asu-alerts', 'alert-processing-queue',
  NOW() - INTERVAL '10 days',
  NOW() - INTERVAL '9 days',
  'admin@aquasense.in'
WHERE NOT EXISTS (
  SELECT 1 FROM alerts WHERE type='pressure_drop' AND meter_id='SMT-W-0041'
);

-- Alerts for Priya (commercial)
INSERT INTO alerts (type, severity, title, description, meter_id, user_id, status, sns_published, sns_topic, sqs_queue, created_at)
SELECT 'anomaly', 'critical',
  'Consumption Anomaly – Factory Main Supply',
  'ML anomaly detector flagged SMT-W-0043 with 3σ deviation from 30-day baseline. Investigate immediately.',
  'SMT-W-0043', 'a0000001-0000-0000-0000-000000000002',
  'active', TRUE, 'asu-alerts', 'alert-processing-queue',
  NOW() - INTERVAL '1 hour'
WHERE NOT EXISTS (
  SELECT 1 FROM alerts WHERE meter_id='SMT-W-0043' AND type='anomaly' AND status='active'
);

-- ── Summary: What this seed provides ─────────────────────────
-- Rajesh Kumar  (user 1): 3 meters, ~30 days readings, 6 months bills (4 paid, 1 overdue, 1 unpaid), 4 payments, 3 active + 1 resolved alert
-- Priya Nair    (user 2): 3 meters, ~30 days readings, 2 months bills (1 paid, 1 unpaid), 1 payment, 1 active alert
-- Tariff rates: water LKR 0.09/L, energy LKR 8.50/kWh, fixed LKR 180/month
