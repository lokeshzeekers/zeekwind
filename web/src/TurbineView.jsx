import { useState } from 'react';

const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '--' : v.toFixed(d));
// Hotspot positions are % of the photo (turbine.jpg)
const PARTS = {
  rotor: { label: 'Rotor and blades', dots: [[32, 24], [69, 22.5], [62, 62], [55, 35.5]], main: 1 },
  nacelle: { label: 'Generator and nacelle', dots: [[47, 43]], main: 0 },
  tail: { label: 'Tail vane and yaw', dots: [[21, 56]], main: 0 },
  tower: { label: 'Tower', dots: [[48.5, 78]], main: 0 },
  grid: { label: 'Electrical and comms', dots: [[46, 94]], main: 0 },
};
const RANK = { ok: 0, warning: 1, critical: 2 };

export default function TurbineView({ sample: s = {}, alerts = [], online }) {
  const [hot, setHot] = useState(null);
  const by = {};
  Object.keys(PARTS).forEach((k) => (by[k] = { sev: 'ok', items: [] }));
  alerts.forEach((a) => {
    const p = by[a.part] || by.nacelle;
    p.items.push(a);
    if (RANK[a.severity] > RANK[p.sev]) p.sev = a.severity;
  });
  const val = {
    rotor: `${f(s.rotor_rpm)} rpm, wind ${f(s.wind_speed)} m/s`,
    nacelle: `${f(s.power_kw)} kW` + (s.generator_temp_c != null ? `, generator ${f(s.generator_temp_c, 0)} °C` : ''),
    tail: `Yaw ${f(s.yaw_angle, 0)}°, wind from ${f(s.wind_direction, 0)}°`,
    tower: s.vibration_mm_s != null ? `Vibration ${f(s.vibration_mm_s, 2)} mm/s` : 'No vibration data sent',
    grid: `${f(s.voltage_v, 0)} V, ${f(s.current_a, 1)} A, ${f(s.frequency_hz, 2)} Hz`,
  };
  const rpm = s.rotor_rpm || 0;

  return (
    <div className="tv">
      <div className="tv-photo">
        <img src="/turbine.jpg" alt="65 kW wind turbine" />
        {online && rpm > 0.5 && <i className="hubring" style={{ left: '55%', top: '35.5%', animationDuration: `${Math.min(8, Math.max(0.9, 120 / rpm))}s` }} />}
        {Object.entries(PARTS).map(([k, p]) => {
          const g = by[k];
          const [mx, my] = p.dots[p.main];
          const left = mx > 52;
          return (
            <div key={k}>
              {p.dots.map(([x, y], i) => (
                <button key={i} className={`hs ${online ? g.sev : 'off'} ${hot === k ? 'on' : ''}`} style={{ left: x + '%', top: y + '%' }}
                  aria-label={p.label} onMouseEnter={() => setHot(k)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(k)} onBlur={() => setHot(null)} />
              ))}
              {g.items.length > 0 ? (
                <div className={`chip ${g.sev} ${left ? 'l' : 'r'}`} style={{ left: mx + '%', top: my + '%' }}>
                  <b>{p.label}</b>{g.items[0].message}{g.items.length > 1 && <em> +{g.items.length - 1} more</em>}
                </div>
              ) : hot === k && (
                <div className={`chip tip ${left ? 'l' : 'r'}`} style={{ left: mx + '%', top: my + '%' }}><b>{p.label}</b>{val[k]}</div>
              )}
            </div>
          );
        })}
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
