import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api, download } from './api.js';
import { withGaps } from './widgets.jsx';

const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '--' : Number(v).toFixed(d));
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const span = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
const autoBucket = (days) => (days <= 1 ? 60 : days <= 7 ? 600 : days <= 31 ? 3600 : 21600);
const BUCKETS = [['auto', 'Automatic'], ['raw', 'Every sample (3-5 s)'], ['60', '1 minute'], ['600', '10 minutes'], ['3600', '1 hour'], ['21600', '6 hours']];

export default function History({ turbine, tz }) {
  const [from, setFrom] = useState(addDays(-6));
  const [to, setTo] = useState(addDays(0));
  const [res, setRes] = useState('auto');
  const [exp, setExp] = useState('60');
  const [d, setD] = useState({ rows: [], daily: [], alerts: [], truncated: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const days = span(from, to);
  const bucket = res === 'auto' ? autoBucket(days) : res;
  const gapMs = bucket === 'raw' ? 30000 : Number(bucket) * 2500;
  const valid = from <= to && days <= 400;

  useEffect(() => {
    if (!valid) return;
    let dead = false; setErr('');
    const qs = `from=${from}&to=${to}`;
    Promise.all([api(`/turbines/${turbine.id}/history?${qs}&bucket=${bucket}`), api(`/turbines/${turbine.id}/daily?${qs}`), api(`/turbines/${turbine.id}/alerts?${qs}`)])
      .then(([h, dl, al]) => !dead && setD({ rows: h.rows.map((r) => ({ ...r, t: new Date(r.t).getTime() })), daily: dl.rows, alerts: al.rows, truncated: h.truncated }))
      .catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [turbine.id, from, to, bucket, valid]);

  const gapped = useMemo(() => withGaps(d.rows, gapMs), [d.rows, gapMs]);
  const tot = useMemo(() => {
    const r = d.daily, e = r.reduce((a, x) => a + x.energy_kwh, 0), wn = r.reduce((a, x) => a + x.wind_n, 0);
    return { energy: e, wind: wn ? r.reduce((a, x) => a + x.sum_wind, 0) / wn : null, peak: Math.max(0, ...r.map((x) => x.max_power)), run: r.reduce((a, x) => a + x.run_seconds, 0) / 3600, cf: r.length ? (e / (turbine.rated_kw * 24 * r.length)) * 100 : null };
  }, [d.daily, turbine.rated_kw]);

  const tFmt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: tz, ...(days <= 1 ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) });
  const get = async (type) => {
    setBusy(true); setErr('');
    try { await download(`/turbines/${turbine.id}/export?type=${type}&from=${from}&to=${to}${type === 'telemetry' ? `&bucket=${exp}` : ''}`, `${turbine.device_id}_${type}.csv`); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const quick = (n) => { setFrom(addDays(-n)); setTo(addDays(0)); };

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
        <div><span>Energy produced</span><b>{f(tot.energy, 1)}<i> kWh</i></b></div>
        <div><span>Average wind</span><b>{f(tot.wind)}<i> m/s</i></b></div>
        <div><span>Peak power</span><b>{f(tot.peak)}<i> kW</i></b></div>
        <div><span>Run time</span><b>{f(tot.run, 2)}<i> h</i></b></div>
        <div><span>Capacity factor</span><b>{f(tot.cf, 2)}<i> %</i></b></div>
      </div>

      <section className="card c12">
        <header><h2>Power and wind speed</h2>{d.truncated && <span className="sub">Showing the latest 20,000 points. Pick a coarser detail level to see the whole range.</span>}</header>
        <div className="chart tall">
          {d.rows.length === 0 ? <p className="empty">No data in this period.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={gapped} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity=".36" /><stop offset="100%" stopColor="#10b981" stopOpacity=".02" /></linearGradient></defs>
                <CartesianGrid stroke="rgba(15,23,42,.08)" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tFmt} tick={{ fontSize: 11 }} minTickGap={70} />
                <YAxis yAxisId="p" tick={{ fontSize: 11 }} unit=" kW" width={58} domain={[0, turbine.rated_kw]} />
                <YAxis yAxisId="w" orientation="right" tick={{ fontSize: 11 }} unit=" m/s" width={58} />
                <Tooltip labelFormatter={tFmt} formatter={(v, n) => [f(v, 1), n]} />
                <Legend />
                <Area yAxisId="p" type="monotone" dataKey="power_kw" name="Power (kW)" stroke="#0d9488" fill="url(#hg)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="w" type="monotone" dataKey="wind_speed" name="Wind (m/s)" stroke="#0284c7" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="card c6">
        <header><h2>Rotor speed</h2></header>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={gapped} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(15,23,42,.08)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tFmt} tick={{ fontSize: 11 }} minTickGap={70} />
              <YAxis tick={{ fontSize: 11 }} unit=" rpm" width={64} />
              <Tooltip labelFormatter={tFmt} formatter={(v) => [f(v, 1) + ' rpm', 'Rotor']} />
              <Line type="monotone" dataKey="rotor_rpm" stroke="#334155" strokeWidth={1.7} dot={false} isAnimationActive={false} />
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
                <pattern id="zwHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill="#10b981" fillOpacity=".16" /><rect width="3.5" height="8" fill="#10b981" fillOpacity=".85" />
                </pattern>
              </defs>
              <CartesianGrid stroke="rgba(15,23,42,.08)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} unit=" kWh" width={70} />
              <Tooltip cursor={{ fill: 'rgba(15,23,42,.04)' }} formatter={(v) => [f(v, 1) + ' kWh', 'Energy']} />
              <Bar dataKey="energy_kwh" fill="url(#zwHatch)" stroke="#10b981" strokeWidth={1.2} radius={[6, 6, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card c12">
        <header>
          <h2>Download</h2>
          <div className="dl">
            <label>Sample detail<select value={exp} onChange={(e) => setExp(e.target.value)}><option value="raw">Every sample</option><option value="60">1 minute average</option><option value="600">10 minute average</option><option value="3600">1 hour average</option></select></label>
            <button className="btn" disabled={busy || !valid} onClick={() => get('telemetry')}>Readings (CSV)</button>
            <button className="btn" disabled={busy || !valid} onClick={() => get('daily')}>Daily summary (CSV)</button>
            <button className="btn" disabled={busy || !valid} onClick={() => get('alerts')}>Alerts (CSV)</button>
          </div>
        </header>
      </section>

      <section className="card c12">
        <header><h2>Daily summary</h2></header>
        <div className="tbl"><table>
          <thead><tr><th>Date</th><th>Energy (kWh)</th><th>Avg wind (m/s)</th><th>Peak wind (m/s)</th><th>Peak power (kW)</th><th>Peak rpm</th><th>Run time (h)</th><th>Capacity factor</th></tr></thead>
          <tbody>
            {[...d.daily].reverse().map((r) => (
              <tr key={r.day}><td>{r.day}</td><td>{f(r.energy_kwh)}</td><td>{r.wind_n ? f(r.sum_wind / r.wind_n) : '--'}</td><td>{f(r.max_wind)}</td><td>{f(r.max_power)}</td><td>{f(r.max_rpm)}</td><td>{f(r.run_seconds / 3600, 2)}</td><td>{f((r.energy_kwh / (turbine.rated_kw * 24)) * 100, 2)} %</td></tr>
            ))}
            {d.daily.length === 0 && <tr><td colSpan="8" className="empty">No data in this period.</td></tr>}
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
