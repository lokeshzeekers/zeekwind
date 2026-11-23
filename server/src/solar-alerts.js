// Solar alert rules. A rule runs ONLY when its limit is set on the plant (solar_plants.limits), so nothing is assumed.
const n = (v) => typeof v === 'number' && Number.isFinite(v);
export const SOLAR_LIMIT_KEYS = ['max_panel_temp', 'max_inv_temp', 'dc_voltage_max', 'ac_voltage_min', 'ac_voltage_max', 'freq_min', 'freq_max', 'min_perf_pct'];

export function evaluateSolar(s, p) {
  const L = p.limits || {};
  const out = [];
  const add = (code, severity, part, message, value = null) => out.push({ code, severity, part, message, value });
  if (s.status === 'fault') add('fault', 'critical', 'inverter', 'Inverter reported a fault');
  if (n(L.max_panel_temp) && n(s.panel_temp_c) && s.panel_temp_c > L.max_panel_temp)
    add('panel_temp', 'warning', 'panels', `Panel temperature ${s.panel_temp_c.toFixed(0)} °C above limit (${L.max_panel_temp})`, s.panel_temp_c);
  if (n(L.max_inv_temp) && n(s.inverter_temp_c) && s.inverter_temp_c > L.max_inv_temp)
    add('inverter_temp', 'critical', 'inverter', `Inverter temperature ${s.inverter_temp_c.toFixed(0)} °C above limit (${L.max_inv_temp})`, s.inverter_temp_c);
  if (n(L.dc_voltage_max) && n(s.dc_voltage_v) && s.dc_voltage_v > L.dc_voltage_max)
    add('dc_overvoltage', 'critical', 'panels', `DC voltage ${s.dc_voltage_v.toFixed(0)} V above limit (${L.dc_voltage_max})`, s.dc_voltage_v);
  if (n(s.ac_voltage_v) && ((n(L.ac_voltage_min) && s.ac_voltage_v < L.ac_voltage_min) || (n(L.ac_voltage_max) && s.ac_voltage_v > L.ac_voltage_max)))
    add('ac_voltage', 'warning', 'grid', `AC voltage ${s.ac_voltage_v.toFixed(0)} V outside allowed range`, s.ac_voltage_v);
  if (n(s.frequency_hz) && ((n(L.freq_min) && s.frequency_hz < L.freq_min) || (n(L.freq_max) && s.frequency_hz > L.freq_max)))
    add('frequency', 'warning', 'grid', `Frequency ${s.frequency_hz.toFixed(2)} Hz outside allowed range`, s.frequency_hz);
  // Under-performance: output far below what the sunlight on the panels should give (shading, soiling, failed string).
  if (n(L.min_perf_pct) && n(s.irradiance_wm2) && n(s.power_kw) && s.status !== 'fault' && s.irradiance_wm2 >= 400 && p.capacity_kwp > 0) {
    const expected = (p.capacity_kwp * s.irradiance_wm2) / 1000, pct = (s.power_kw / expected) * 100;
    if (pct < L.min_perf_pct) add('underperf', 'warning', 'panels', `Output ${s.power_kw.toFixed(1)} kW is only ${pct.toFixed(0)}% of the ${expected.toFixed(1)} kW expected at ${s.irradiance_wm2.toFixed(0)} W/m²`, s.power_kw);
  }
  return out;
}
