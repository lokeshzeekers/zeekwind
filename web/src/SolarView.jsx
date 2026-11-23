import { useState } from 'react';
import { f } from './util.js';

// Hotspot positions are % of the picture (/solar-plant.svg). chip = where the floating label anchors, side = which way it opens.
// If you swap in a photo, only these numbers need adjusting.
const PARTS = {
  panels: { label: 'Solar panels', dots: [[45, 78.8], [45, 61.4]], chip: [30, 44], side: 'r' },
  inverter: { label: 'Inverter', dots: [[88.1, 74]], chip: [88, 58], side: 'l' },
  grid: { label: 'Grid connection', dots: [[91, 44]], chip: [91, 34], side: 'l' },
  weather: { label: 'Weather sensors', dots: [[5.6, 66.4]], chip: [4, 50], side: 'r' },
};
const RANK = { ok: 0, warning: 1, critical: 2 };

export default function SolarView({ sample: s = {}, alerts = [], online, plant }) {
  const [hot, setHot] = useState(null);
  const by = {};
  Object.keys(PARTS).forEach((k) => (by[k] = { sev: 'ok', items: [] }));
  alerts.forEach((a) => {
    const p = by[a.part] || by.inverter;
    p.items.push(a);
    if (RANK[a.severity] > RANK[p.sev]) p.sev = a.severity;
  });
  const val = {
    panels: s.dc_voltage_v != null || s.dc_current_a != null
      ? `${f(s.dc_voltage_v, 0)} V DC, ${f(s.dc_current_a, 1)} A` + (s.panel_temp_c != null ? `, panels ${f(s.panel_temp_c, 0)} °C` : '')
      : s.panel_temp_c != null ? `Panels ${f(s.panel_temp_c, 0)} °C` : 'No DC data sent',
    inverter: `${f(s.power_kw)} kW AC` + (s.efficiency_pct != null ? `, efficiency ${f(s.efficiency_pct, 1)} %` : '') + (s.inverter_temp_c != null ? `, ${f(s.inverter_temp_c, 0)} °C` : ''),
    grid: `${f(s.ac_voltage_v, 0)} V, ${f(s.ac_current_a, 1)} A, ${f(s.frequency_hz, 2)} Hz`,
    weather: s.irradiance_wm2 != null ? `${f(s.irradiance_wm2, 0)} W/m²` + (s.ambient_temp_c != null ? `, ambient ${f(s.ambient_temp_c, 0)} °C` : '') : 'No sensor data sent',
  };
  const glow = online && s.irradiance_wm2 > 0 ? Math.min(1, s.irradiance_wm2 / 1000) : 0;

  return (
    <div className="tv">
      <div className="tv-photo">
        <img src="/solar-plant.svg" alt="Solar power plant" />
        <i className="sunglow" style={{ opacity: glow }} />
        {Object.entries(PARTS).map(([k, p]) => {
          const g = by[k];
          const [cx, cy] = p.chip;
          return (
            <div key={k}>
              {p.dots.map(([x, y], i) => (
                <button key={i} className={`hs ${online ? g.sev : 'off'} ${hot === k ? 'on' : ''}`} style={{ left: x + '%', top: y + '%' }}
                  aria-label={p.label} onMouseEnter={() => setHot(k)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(k)} onBlur={() => setHot(null)} />
              ))}
              {g.items.length > 0 ? (
                <div className={`chip ${g.sev} ${p.side}`} style={{ left: cx + '%', top: cy + '%' }}>
                  <b>{p.label}</b>{g.items[0].message}{g.items.length > 1 && <em> +{g.items.length - 1} more</em>}
                </div>
              ) : hot === k && (
                <div className={`chip tip ${p.side}`} style={{ left: cx + '%', top: cy + '%' }}><b>{p.label}</b>{val[k]}</div>
              )}
            </div>
          );
        })}
        <div className="psum">
          <span>Plant size</span>
          <b>{plant.panel_count != null ? `${plant.panel_count} panels` : `${f(plant.capacity_kwp, 1)} kWp`}</b>
          {plant.panel_count != null && <em>{f(plant.capacity_kwp, 1)} kWp</em>}
        </div>
      </div>
      <ul className="parts">
        {Object.entries(PARTS).map(([k, p]) => (
          <li key={k} className={hot === k ? 'on' : ''} onMouseEnter={() => setHot(k)} onMouseLeave={() => setHot(null)}>
            <span className={`dot ${online ? by[k].sev : 'off'}`} />
            <div><b>{p.label}</b><span>{val[k]}</span>
              {by[k].items.map((a) => <small key={a.code} className={a.severity}>{a.message}</small>)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
