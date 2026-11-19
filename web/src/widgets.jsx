const polar = (cx, cy, r, deg) => { const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
const arc = (r, a0, a1) => {
  const [x0, y0] = polar(100, 100, r, a0), [x1, y1] = polar(100, 100, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

// 270-degree dial with tick marks (value fills ticks and arc)
export function Gauge({ value, max, unit, caption, decimals = 0, dark }) {
  const v = Number.isFinite(value) ? value : 0;
  const frac = Math.max(0, Math.min(1, v / max));
  return (
    <svg viewBox="0 0 200 200" className={'gauge' + (dark ? ' dark' : '')} role="img" aria-label={`${caption}: ${v.toFixed(decimals)} ${unit}`}>
      <defs>
        <linearGradient id="zwGauge" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0d9488" /><stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      {[...Array(41)].map((_, i) => {
        const a = -135 + (270 * i) / 40, big = i % 5 === 0;
        const [x0, y0] = polar(100, 100, 80, a), [x1, y1] = polar(100, 100, big ? 94 : 88, a);
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={i / 40 <= frac + 0.001 ? 'tk on' : 'tk'} />;
      })}
      <path d={arc(66, -135, 135)} className="trk" />
      {frac > 0 && <path d={arc(66, -135, -135 + 270 * frac)} className="val" />}
      <text x="100" y="92" className="g-cap">{caption}</text>
      <text x="100" y="124" className="g-val">{Number.isFinite(value) ? v.toFixed(decimals) : '--'}</text>
      <text x="100" y="144" className="g-unit">{unit}</text>
    </svg>
  );
}

// Wind compass: arrow = direction the wind blows FROM; rotor glyph = nacelle yaw
export function Compass({ dir, yaw }) {
  return (
    <svg viewBox="0 0 200 200" className="compass" role="img" aria-label="Wind direction and nacelle yaw">
      <circle cx="100" cy="100" r="88" className="ring r1" />
      <circle cx="100" cy="100" r="62" className="ring r2" />
      <circle cx="100" cy="100" r="36" className="ring r3" />
      {[['N', 100, 17], ['E', 186, 104], ['S', 100, 193], ['W', 14, 104]].map(([t, x, y]) => <text key={t} x={x} y={y} className="dir">{t}</text>)}
      {Number.isFinite(yaw) && (
        <g transform={`rotate(${yaw} 100 100)`} className="nac">
          <line x1="100" y1="100" x2="100" y2="72" /><line x1="80" y1="72" x2="120" y2="72" className="disc" />
        </g>
      )}
      {Number.isFinite(dir) && (
        <g transform={`rotate(${dir} 100 100)`} className="arrow">
          <line x1="100" y1="14" x2="100" y2="66" /><path d="M92 56L100 70L108 56Z" />
        </g>
      )}
      <circle cx="100" cy="100" r="5" className="hub" />
    </svg>
  );
}

// Insert a break wherever consecutive points are further apart than maxGapMs, so charts do not draw lines across outages
export function withGaps(rows, maxGapMs) {
  const out = [];
  rows.forEach((r, i) => { out.push(r); if (rows[i + 1] && rows[i + 1].t - r.t > maxGapMs) out.push({ t: r.t + 1 }); });
  return out;
}
