// Alert rules. A rule runs ONLY when its limit is set on the turbine (turbines.limits), so nothing is assumed.
const n = (v) => typeof v === 'number' && Number.isFinite(v);
export const LIMIT_KEYS = ['max_rpm', 'cut_out', 'rated_wind', 'max_power_kw', 'max_gen_temp', 'max_vibration', 'voltage_min', 'voltage_max', 'freq_min', 'freq_max'];

export function evaluate(s, t) {
  const L = t.limits || {};
  const out = [];
  const add = (code, severity, part, message, value = null) => out.push({ code, severity, part, message, value });
  if (s.status === 'fault') add('fault', 'critical', 'nacelle', 'Controller reported a fault');
  if (n(L.max_rpm) && n(s.rotor_rpm) && s.rotor_rpm > L.max_rpm)
    add('overspeed', 'critical', 'rotor', `Rotor over-speed: ${s.rotor_rpm.toFixed(1)} rpm (limit ${L.max_rpm})`, s.rotor_rpm);
  if (n(L.cut_out) && n(s.wind_speed) && s.wind_speed > L.cut_out)
    add('overwind', 'warning', 'rotor', `Wind ${s.wind_speed.toFixed(1)} m/s above cut-out (${L.cut_out})`, s.wind_speed);
  if (n(L.rated_wind) && n(s.wind_speed) && n(s.power_kw) && !s.brake && s.status !== 'stopped' &&
      s.wind_speed >= L.rated_wind && (!n(L.cut_out) || s.wind_speed <= L.cut_out) && s.power_kw < 0.5 * t.rated_kw)
    add('underperf', 'warning', 'rotor', `Low output ${s.power_kw.toFixed(1)} kW at ${s.wind_speed.toFixed(1)} m/s wind`, s.power_kw);
  if (n(L.max_power_kw) && n(s.power_kw) && s.power_kw > L.max_power_kw)
    add('overpower', 'warning', 'nacelle', `Power ${s.power_kw.toFixed(1)} kW above limit ${L.max_power_kw}`, s.power_kw);
  if (n(L.max_gen_temp) && n(s.generator_temp_c) && s.generator_temp_c > L.max_gen_temp)
    add('gen_temp', 'critical', 'nacelle', `Generator temperature ${s.generator_temp_c.toFixed(0)} °C above limit`, s.generator_temp_c);
  if (n(L.max_vibration) && n(s.vibration_mm_s) && s.vibration_mm_s > L.max_vibration)
    add('vibration', 'warning', 'tower', `Vibration ${s.vibration_mm_s.toFixed(2)} mm/s above limit`, s.vibration_mm_s);
  if (n(s.voltage_v) && ((n(L.voltage_min) && s.voltage_v < L.voltage_min) || (n(L.voltage_max) && s.voltage_v > L.voltage_max)))
    add('voltage', 'warning', 'grid', `Voltage ${s.voltage_v.toFixed(0)} V outside allowed range`, s.voltage_v);
  if (n(s.frequency_hz) && ((n(L.freq_min) && s.frequency_hz < L.freq_min) || (n(L.freq_max) && s.frequency_hz > L.freq_max)))
    add('frequency', 'warning', 'grid', `Frequency ${s.frequency_hz.toFixed(2)} Hz outside allowed range`, s.frequency_hz);
  return out;
}
