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

-- =====================================================================
-- Solar power plants (separate from wind: own plants, assignments, history, alerts)
-- =====================================================================
CREATE TABLE IF NOT EXISTS solar_plants (
  id SERIAL PRIMARY KEY,
  device_id TEXT UNIQUE NOT NULL,          -- also the MQTT username of the plant gateway
  name TEXT NOT NULL,
  location TEXT,
  capacity_kwp DOUBLE PRECISION NOT NULL DEFAULT 10,   -- installed DC capacity of the panels
  inverter_kw DOUBLE PRECISION,                         -- AC rating of the inverter(s); gauge maximum (falls back to capacity_kwp)
  panel_count INT,
  limits JSONB NOT NULL DEFAULT '{}',       -- alert thresholds; a rule is active only when its limit is set
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_solar_plants (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  plant_id INT REFERENCES solar_plants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, plant_id)
);
CREATE TABLE IF NOT EXISTS solar_telemetry (
  id BIGSERIAL PRIMARY KEY,
  plant_id INT NOT NULL REFERENCES solar_plants(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  power_kw DOUBLE PRECISION,               -- AC output
  dc_power_kw DOUBLE PRECISION, dc_voltage_v DOUBLE PRECISION, dc_current_a DOUBLE PRECISION,
  ac_voltage_v DOUBLE PRECISION, ac_current_a DOUBLE PRECISION, frequency_hz DOUBLE PRECISION, power_factor DOUBLE PRECISION,
  irradiance_wm2 DOUBLE PRECISION, panel_temp_c DOUBLE PRECISION, ambient_temp_c DOUBLE PRECISION, inverter_temp_c DOUBLE PRECISION,
  efficiency_pct DOUBLE PRECISION,
  status TEXT,
  energy_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,  -- energy produced since the previous sample
  extra JSONB
);
CREATE INDEX IF NOT EXISTS solar_telemetry_plant_ts ON solar_telemetry (plant_id, ts DESC);
CREATE TABLE IF NOT EXISTS solar_daily_summary (
  plant_id INT NOT NULL REFERENCES solar_plants(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  energy_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  samples INT NOT NULL DEFAULT 0,
  sum_power DOUBLE PRECISION NOT NULL DEFAULT 0, max_power DOUBLE PRECISION NOT NULL DEFAULT 0,
  irr_wh DOUBLE PRECISION NOT NULL DEFAULT 0,                  -- insolation, Wh/m2 (irradiance integrated over time)
  sum_irr DOUBLE PRECISION NOT NULL DEFAULT 0, irr_n INT NOT NULL DEFAULT 0, max_irr DOUBLE PRECISION NOT NULL DEFAULT 0,
  sum_ptemp DOUBLE PRECISION NOT NULL DEFAULT 0, ptemp_n INT NOT NULL DEFAULT 0, max_ptemp DOUBLE PRECISION NOT NULL DEFAULT 0,
  run_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (plant_id, day)
);
CREATE TABLE IF NOT EXISTS solar_alerts (
  id BIGSERIAL PRIMARY KEY,
  plant_id INT NOT NULL REFERENCES solar_plants(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  code TEXT NOT NULL, severity TEXT NOT NULL, part TEXT NOT NULL,
  message TEXT NOT NULL, value DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT true,
  cleared_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS solar_alerts_plant_ts ON solar_alerts (plant_id, ts DESC);
