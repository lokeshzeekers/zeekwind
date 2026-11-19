import { useState } from 'react';

const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '--' : v.toFixed(d));
// Hotspot positions are % of the photo (turbine.jpg). chip = where the floating label anchors, side = which way it opens.
const PARTS = {
  rotor: { label: 'Rotor and blades', dots: [[40.7, 24.3], [70.2, 22.7], [61.8, 55.8], [57, 33.9]], main: 0, chip: [34, 10], side: 'r' },
  nacelle: { label: 'Generator and nacelle', dots: [[52.2, 36.3]], main: 0, chip: [62, 46], side: 'r' },
  tail: { label: 'Tail vane and yaw', dots: [[19.1, 47]], main: 0, chip: [4, 30], side: 'r' },
  tower: { label: 'Tower', dots: [[50.1, 64]], main: 0, chip: [50.1, 82], side: 'l' },
  grid: { label: 'Electrical and comms', dots: [[50.1, 90]], main: 0, chip: [50.1, 92], side: 'l' },
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
  const yaw = Number.isFinite(s.yaw_angle) ? s.yaw_angle : null;

  return (
    <div className="tv">
      <div className="tv-photo">
        <img src="/turbine.jpg" alt="65 kW wind turbine" />
        {online && rpm > 0.5 && <i className="hubring" style={{ left: '57%', top: '33.9%', animationDuration: `${Math.min(8, Math.max(0.9, 120 / rpm))}s` }} />}
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
        <div className="yaw" aria-label={`Nacelle yaw ${f(yaw, 0)} degrees`}>
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" className="yr" />
            {[...Array(36)].map((_, i) => { const a = (i * 10 * Math.PI) / 180, big = i % 9 === 0; return <line key={i} x1={50 + 38 * Math.sin(a)} y1={50 - 38 * Math.cos(a)} x2={50 + (big ? 44 : 41) * Math.sin(a)} y2={50 - (big ? 44 : 41) * Math.cos(a)} className={big ? 'yt big' : 'yt'} />; })}
            {yaw != null && <g transform={`rotate(${yaw} 50 50)`}><path d="M50 8L56 22H44Z" className="ya" /></g>}
            <text x="50" y="30" className="yl">YAW</text>
            <text x="50" y="58" className="yv">{yaw != null ? Math.round(yaw) + '°' : '--'}</text>
          </svg>
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
