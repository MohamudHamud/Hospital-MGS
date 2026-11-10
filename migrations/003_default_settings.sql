-- 003: default settings for a new installation (existing values are kept)
INSERT IGNORE INTO settings (k, v) VALUES
  ('hospital_name', 'My Hospital'),
  ('tagline', 'Complete care, full circle.'),
  ('address', ''),
  ('phone', ''),
  ('email', ''),
  ('currency', '$'),
  ('slot_start', '08:00'),
  ('slot_end', '17:00'),
  ('slot_minutes', '30'),
  ('expiry_alert_days', '90');
