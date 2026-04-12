-- ============================================================
-- AquaSense – Seed Data
-- Run AFTER schema.sql
-- psql -U aqua_admin -d aquasense_db -f seed.sql
-- ============================================================

-- Tariff rates (the ONLY "config" values – stored in DB, not code)
INSERT INTO tariff_rates (resource_type, rate_per_unit, unit, currency) VALUES
  ('water',  0.006,  'per litre', 'INR'),
  ('energy', 8.50,   'per kWh',   'INR'),
  ('fixed',  180.00, 'monthly',   'INR')
ON CONFLICT DO NOTHING;

-- Demo users (passwords = bcrypt of 'password123')
INSERT INTO users (id, name, email, password_hash, role) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Rajesh Kumar', 'rajesh@aquasense.in',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'residential'),
  ('a0000001-0000-0000-0000-000000000002', 'Priya Nair',   'priya@aquasense.in',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'commercial'),
  ('a0000001-0000-0000-0000-000000000003', 'Admin User',   'admin@aquasense.in',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Smart meters
INSERT INTO meters (id, user_id, type, location, status, mqtt_topic) VALUES
  ('SMT-W-0041', 'a0000001-0000-0000-0000-000000000001', 'water',  'Kitchen Block, Unit A',  'online',  'smartmeter/water/usage'),
  ('SMT-W-0042', 'a0000001-0000-0000-0000-000000000001', 'water',  'Garden Zone South',      'online',  'smartmeter/water/usage'),
  ('SMT-E-0087', 'a0000001-0000-0000-0000-000000000001', 'energy', 'Distribution Board',     'online',  'smartmeter/energy/usage'),
  ('SMT-W-0043', 'a0000001-0000-0000-0000-000000000002', 'water',  'Factory Main Supply',    'warning', 'smartmeter/water/usage'),
  ('SMT-E-0088', 'a0000001-0000-0000-0000-000000000002', 'energy', 'HVAC Unit',              'online',  'smartmeter/energy/usage'),
  ('SMT-W-0044', 'a0000001-0000-0000-0000-000000000002', 'water',  'Backup Supply',          'offline', 'smartmeter/water/leakage')
ON CONFLICT (id) DO NOTHING;

-- Alert subscriptions (SNS endpoints)
INSERT INTO alert_subscriptions (protocol, endpoint, topic, confirmed) VALUES
  ('email',  'admin@aquasense.in',               'asu-alerts', true),
  ('sms',    '+91-9876543210',                   'asu-alerts', true),
  ('lambda', 'arn:aws:lambda:ap-south-1:123456789012:function:alert-dispatcher', 'asu-alerts', true)
ON CONFLICT DO NOTHING;

-- Sample alert
INSERT INTO alerts (type, severity, title, description, meter_id, user_id, status, sns_published, sns_topic, sqs_queue)
  SELECT 'leakage','critical','Leakage Detected – Zone C',
    'Flow sensor registered 0.4 L/hr at 02:45 AM. Possible pipe leak.',
    'SMT-W-0041', 'a0000001-0000-0000-0000-000000000001',
    'active', false, 'asu-alerts', 'alert-processing-queue'
  WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE meter_id='SMT-W-0041' AND status='active');
