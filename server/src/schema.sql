CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS turbines (
  id SERIAL PRIMARY KEY,
  device_id TEXT UNIQUE NOT NULL,          -- also the MQTT username of the turbine gateway
  name TEXT NOT NULL,
  location TEXT,
  rated_kw DOUBLE PRECISION NOT NULL DEFAULT 65,
  limits JSONB NOT NULL DEFAULT '{}',       -- alert thresholds; a rule is active only when its limit is set
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_turbines (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  turbine_id INT REFERENCES turbines(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, turbine_id)
);
CREATE TABLE IF NOT EXISTS telemetry (
  id BIGSERIAL PRIMARY KEY,
  turbine_id INT NOT NULL REFERENCES turbines(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  wind_speed DOUBLE PRECISION, wind_direction DOUBLE PRECISION,
  rotor_rpm DOUBLE PRECISION, power_kw DOUBLE PRECISION,
  voltage_v DOUBLE PRECISION, current_a DOUBLE PRECISION, frequency_hz DOUBLE PRECISION,
  yaw_angle DOUBLE PRECISION, generator_temp_c DOUBLE PRECISION, vibration_mm_s DOUBLE PRECISION,
  brake BOOLEAN, status TEXT,
  energy_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,  -- energy produced since the previous sample
  extra JSONB
);
CREATE INDEX IF NOT EXISTS telemetry_turbine_ts ON telemetry (turbine_id, ts DESC);
CREATE TABLE IF NOT EXISTS daily_summary (
  turbine_id INT NOT NULL REFERENCES turbines(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  energy_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  samples INT NOT NULL DEFAULT 0,
  sum_wind DOUBLE PRECISION NOT NULL DEFAULT 0, wind_n INT NOT NULL DEFAULT 0,
  sum_power DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_wind DOUBLE PRECISION NOT NULL DEFAULT 0, max_power DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_rpm DOUBLE PRECISION NOT NULL DEFAULT 0,
  run_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (turbine_id, day)
);
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  turbine_id INT NOT NULL REFERENCES turbines(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  code TEXT NOT NULL, severity TEXT NOT NULL, part TEXT NOT NULL,
  message TEXT NOT NULL, value DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT true,
  cleared_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS alerts_turbine_ts ON alerts (turbine_id, ts DESC);
