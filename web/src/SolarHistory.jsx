import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api, download } from './api.js';
import { withGaps } from './widgets.jsx';
import { f, addDays, span, autoBucket } from './util.js';

const BUCKETS = [['auto', 'Automatic'], ['raw', 'Every sample (3-5 s)'], ['60', '1 minute'], ['300', '5 minutes'], ['900', '15 minutes'], ['3600', '1 hour'], ['21600', '6 hours']];

export default function SolarHistory({ plant, tz }) {
  const [from, setFrom] = useState(addDays(-6));
  const [to, setTo] = useState(addDays(0));
  const [res, setRes] = useState('auto');
  const [exp, setExp] = useState('300');
  const [d, setD] = useState({ rows: [], daily: [], alerts: [], truncated: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const days = span(from, to);
  const bucket = res === 'auto' ? autoBucket(days) : res;
  const gapMs = bucket === 'raw' ? 30000 : Number(bucket) * 2.5 * 1000;
  const valid = from <= to && days <= 400;
  const kwp = plant.capacity_kwp;

  useEffect(() => {
    if (!valid) return undefined;
    let dead = false; setErr('');
    const qs = `from=${from}&to=${to}`;
    Promise.all([api(`/solar/${plant.id}/history?${qs}&bucket=${bucket}`), api(`/solar/${plant.id}/daily?${qs}`), api(`/solar/${plant.id}/alerts?${qs}`)])
      .then(([h, dl, al]) => !dead && setD({ rows: h.rows.map((r) => ({ ...r, t: new Date(r.t).getTime() })), daily: dl.rows, alerts: al.rows, truncated: h.truncated }))
      .catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [plant.id, from, to, bucket, valid]);

  const gapped = useMemo(() => withGaps(d.rows, gapMs), [d.rows, gapMs]);
  const tot = useMemo(() => {
    const r = d.daily, e = r.reduce((a, x) => a + x.energy_kwh, 0), ins = r.reduce((a, x) => a + x.irr_wh, 0) / 1000;
    return { energy: e, peak: Math.max(0, ...r.map((x) => x.max_power)), ins: ins > 0 ? ins : null, sy: r.length && kwp > 0 ? e / kwp : null, pr: ins > 0 && kwp > 0 ? (e / (kwp * ins)) * 100 : null, run: r.reduce((a, x) => a + x.run_seconds, 0) / 3600 };
  }, [d.daily, kwp]);
  const chartDaily = useMemo(() => d.daily.map((x) => ({ ...x, pr: x.irr_wh > 0 && kwp > 0 ? (x.energy_kwh / (kwp * x.irr_wh / 1000)) * 100 : null })), [d.daily, kwp]);

  const tFmt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: tz, ...(days <= 1 ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) });
  const get = async (type) => {
    setBusy(true); setErr('');
    try { await download(`/solar/${plant.id}/export?type=${type}&from=${from}&to=${to}${type === 'telemetry' ? `&bucket=${exp}` : ''}`, `${plant.device_id}_${type}.csv`); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const quick = (n) => { setFrom(addDays(-n)); setTo(addDays(0)); };
  const grid = <CartesianGrid stroke="rgba(15,23,42,.08)" strokeDasharray="3 4" vertical={false} />;
  const xAxis = <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tFmt} tick={{ fontSize: 11 }} minTickGap={70} />;

  return (
    <div className="grid">
      <section className="card c12 filters">
        <label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="seg"><button onClick={() => quick(0)}>Today</button><button onClick={() => quick(6)}>7 days</button><button onClick={() => quick(29)}>30 days</button><button onClick={() => quick(364)}>1 year</button></div>
        <label>Chart detail<select value={res} onChange={(e) => setRes(e.target.value)}>{BUCKETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <span className="sub grow-r">Days are cut at midnight, {tz}</span>
      </section>
      {!valid && <div className="banner bad c12">Choose a start date before the end date, no more than 400 days apart.</div>}
      {err && <div className="banner bad c12">{err}</div>}

      <div className="stats c12">
        <div><span>Energy generated</span><b>{f(tot.energy, 1)}<i> kWh</i></b></div>
        <div><span>Peak power</span><b>{f(tot.peak, 2)}<i> kW</i></b></div>
        <div><span>Sunlight received</span><b>{f(tot.ins, 1)}<i> kWh/m²</i></b></div>
        <div><span>Specific yield</span><b>{f(tot.sy, 1)}<i> kWh/kWp</i></b></div>
        <div><span>Performance ratio</span><b>{f(tot.pr, 1)}<i> %</i></b></div>
      </div>

      <section className="card c12">
        <header><h2>Power and sunlight</h2>{d.truncated && <span className="sub">Showing the latest 20,000 points. Pick a coarser detail level to see the whole range.</span>}</header>
        <div className="chart tall">
          {d.rows.length === 0 ? <p className="empty">No data in this period.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={gapped} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <defs><linearGradient id="shg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity=".4" /><stop offset="100%" stopColor="#f59e0b" stopOpacity=".02" /></linearGradient></defs>
                {grid}{xAxis}
                <YAxis yAxisId="p" tick={{ fontSize: 11 }} unit=" kW" width={58} domain={[0, plant.rated_kw]} />
                <YAxis yAxisId="i" orientation="right" tick={{ fontSize: 11 }} unit=" W/m²" width={70} domain={[0, 1200]} />
                <Tooltip labelFormatter={tFmt} formatter={(v, n) => [f(v, n.startsWith('Power') ? 2 : 0), n]} />
                <Legend />
                <Area yAxisId="p" type="monotone" dataKey="power_kw" name="Power (kW)" stroke="#d97706" fill="url(#shg)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="i" type="monotone" dataKey="irradiance_wm2" name="Irradiance (W/m²)" stroke="#0284c7" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="card c6">
        <header><h2>Temperatures</h2></header>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={gapped} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              {grid}{xAxis}
              <YAxis tick={{ fontSize: 11 }} unit=" °C" width={58} />
              <Tooltip labelFormatter={tFmt} formatter={(v, n) => [f(v, 1) + ' °C', n]} />
              <Legend />
              <Line type="monotone" dataKey="panel_temp_c" name="Panel" stroke="#ef4444" strokeWidth={1.7} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="inverter_temp_c" name="Inverter" stroke="#6366f1" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="ambient_temp_c" name="Ambient" stroke="#64748b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card c6">
        <header><h2>Energy per day</h2></header>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.daily} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <pattern id="zpHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill="#f59e0b" fillOpacity=".16" /><rect width="3.5" height="8" fill="#f59e0b" fillOpacity=".85" />
                </pattern>
              </defs>
              {grid}
              <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} unit=" kWh" width={70} />
              <Tooltip cursor={{ fill: 'rgba(15,23,42,.04)' }} formatter={(v) => [f(v, 1) + ' kWh', 'Energy']} />
              <Bar dataKey="energy_kwh" fill="url(#zpHatch)" stroke="#f59e0b" strokeWidth={1.2} radius={[6, 6, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card c12">
        <header><h2>Performance ratio per day</h2><span className="sub">energy produced compared with what the sunlight on the panels could give</span></header>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartDaily} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              {grid}
              <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} unit=" %" width={58} domain={[0, 100]} />
              <Tooltip formatter={(v) => [f(v, 1) + ' %', 'Performance ratio']} />
              <Line type="monotone" dataKey="pr" stroke="#0d9488" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card c12">
        <header>
          <h2>Download</h2>
          <div className="dl">
            <label>Sample detail<select value={exp} onChange={(e) => setExp(e.target.value)}><option value="raw">Every sample</option><option value="60">1 minute average</option><option value="300">5 minute average</option><option value="900">15 minute average</option><option value="3600">1 hour average</option></select></label>
            <button className="btn" disabled={busy || !valid} onClick={() => get('telemetry')}>Readings (CSV)</button>
            <button className="btn" disabled={busy || !valid} onClick={() => get('daily')}>Daily summary (CSV)</button>
            <button className="btn" disabled={busy || !valid} onClick={() => get('alerts')}>Alerts (CSV)</button>
          </div>
        </header>
      </section>

      <section className="card c12">
        <header><h2>Daily summary</h2></header>
        <div className="tbl"><table>
          <thead><tr><th>Date</th><th>Energy (kWh)</th><th>Yield (kWh/kWp)</th><th>Sunlight (kWh/m²)</th><th>Perf. ratio</th><th>Peak power (kW)</th><th>Peak irradiance (W/m²)</th><th>Max panel temp (°C)</th><th>Generating (h)</th></tr></thead>
          <tbody>
            {[...chartDaily].reverse().map((r) => (
              <tr key={r.day}><td>{r.day}</td><td>{f(r.energy_kwh)}</td><td>{kwp > 0 ? f(r.energy_kwh / kwp, 2) : '--'}</td><td>{r.irr_wh > 0 ? f(r.irr_wh / 1000, 2) : '--'}</td><td>{r.pr != null ? f(r.pr, 1) + ' %' : '--'}</td>
                <td>{f(r.max_power, 2)}</td><td>{f(r.max_irr, 0)}</td><td>{r.ptemp_n ? f(r.max_ptemp, 1) : '--'}</td><td>{f(r.run_seconds / 3600, 2)}</td></tr>
            ))}
            {d.daily.length === 0 && <tr><td colSpan="9" className="empty">No data in this period.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="card c12">
        <header><h2>Alert history</h2></header>
        <div className="tbl"><table>
          <thead><tr><th>Raised</th><th>Level</th><th>Alert</th><th>Cleared</th></tr></thead>
          <tbody>
            {d.alerts.map((a) => (
              <tr key={a.id}><td>{new Date(a.ts).toLocaleString('en-GB', { timeZone: tz })}</td><td><span className={'pill ' + a.severity}>{a.severity}</span></td><td>{a.message}</td>
                <td>{a.active ? <span className="pill warning">Still active</span> : new Date(a.cleared_at).toLocaleString('en-GB', { timeZone: tz })}</td></tr>
            ))}
            {d.alerts.length === 0 && <tr><td colSpan="4" className="empty">No alerts in this period.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
