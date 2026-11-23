import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import SolarView from './SolarView.jsx';
import { Gauge, withGaps } from './widgets.jsx';
import { api } from './api.js';
import { f, hhmmss, hhmm, energy, insolation, specificYield, perfRatio, co2 } from './util.js';

function Spark({ data }) {
  if (data.length < 2) return null;
  const mx = Math.max(...data, 1);
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 100).toFixed(1)},${(22 - (v / mx) * 20).toFixed(1)}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" /></svg>;
}
function useNow(ms) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}
const since = (s) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

export default function SolarDashboard({ plant, live = {}, conn, co2Factor }) {
  const s = live.sample || {}, online = !!live.online, asleep = !!live.asleep, rated = plant.rated_kw, kwp = plant.capacity_kwp;
  const td = live.today, alerts = live.alerts || [];
  const now = useNow(1000);
  const [win, setWin] = useState(15);
  const [dayRows, setDayRows] = useState([]);
  const ago = live.ts ? Math.max(0, Math.round((now - new Date(live.ts).getTime()) / 1000)) : null;
  const status = !online ? (asleep ? 'standby' : 'offline') : s.status === 'fault' ? 'fault' : s.status || (s.power_kw > 0.05 ? 'running' : 'idle');
  const series = live.series || [];
  const end = series.length ? series[series.length - 1].t : now;
  const liveData = withGaps(series.filter((p) => p.t >= end - win * 60000), 20000);
  const invAlerts = alerts.filter((a) => a.part === 'inverter');
  const invSev = invAlerts.some((a) => a.severity === 'critical') ? 'critical' : invAlerts.length ? 'warning' : 'ok';

  // "Today" chart: 5-minute averages of the whole local day, refreshed every minute
  useEffect(() => {
    if (win !== 0 || !live.todayDate) return undefined;
    let dead = false;
    const load = () => api(`/solar/${plant.id}/history?from=${live.todayDate}&to=${live.todayDate}&bucket=300`)
      .then((h) => !dead && setDayRows(h.rows.map((r) => ({ t: new Date(r.t).getTime(), power: r.power_kw, irr: r.irradiance_wm2 })))).catch(() => {});
    load();
    const i = setInterval(load, 60000);
    return () => { dead = true; clearInterval(i); };
  }, [win, plant.id, live.todayDate]);
  const data = win === 0 ? withGaps(dayRows, 900000) : liveData;
  const tick = win === 0 ? hhmm : hhmmss;

  const ins = insolation(td), sy = specificYield(td?.energy_kwh, kwp), pr = perfRatio(td?.energy_kwh, kwp, ins);
  const co2kg = live.total != null ? live.total * co2Factor : null;

  return (
    <div className={'grid' + (online ? '' : ' is-off')}>
      {!live.ts && <div className="banner c12">No data has been received from this solar plant yet. Check the gateway connection (see the guide).</div>}
      {live.ts && asleep && <div className="banner info c12">Plant is in standby (no sunlight). Last data {ago != null ? since(ago) : ''} ago. It resumes by itself at sunrise.</div>}
      {live.ts && !online && !asleep && <div className="banner bad c12">Solar plant offline. Last data {ago != null ? since(ago) : ''} ago. Values shown are the last readings.</div>}
      {!conn && <div className="banner c12">Live connection lost. Reconnecting…</div>}

      <div className="stats c12">
        <div><span>Daily generation</span><b>{td ? f(td.energy_kwh, 1) : '--'}<i> kWh</i></b></div>
        <div><span>This month</span><b>{live.month != null ? f(live.month, 1) : '--'}<i> kWh</i></b></div>
        <div><span>Lifetime energy</span><b>{live.total != null ? (live.total >= 10000 ? f(live.total / 1000, 2) : f(live.total, 1)) : '--'}<i>{live.total >= 10000 ? ' MWh' : ' kWh'}</i></b></div>
        <div><span>Specific yield today</span><b>{f(sy, 2)}<i> kWh/kWp</i></b></div>
        <div><span>CO₂ avoided (est.)</span><b>{co2(co2kg)}</b></div>
      </div>

      <section className="card c8">
        <header><h2>{plant.name}</h2><span className="sub">{plant.location || plant.device_id} · {f(kwp, 1)} kWp</span></header>
        <SolarView sample={s} alerts={alerts} online={online} plant={plant} />
      </section>

      <div className="col c4">
        <section className="card">
          <header><h2>Status</h2><span className={'pill ' + status.replace(' ', '-')}>{status}</span></header>
          <dl className="kv">
            <dt>Last update</dt><dd>{ago == null ? '--' : `${since(ago)} ago`}</dd>
            <dt>Installed capacity</dt><dd>{f(kwp, 1)} kWp</dd>
            <dt>Inverter rating</dt><dd>{plant.inverter_kw ? f(plant.inverter_kw, 1) + ' kW' : '--'}</dd>
            <dt>Number of panels</dt><dd>{plant.panel_count ?? '--'}</dd>
            <dt>Generating time today</dt><dd>{td ? f(td.run_seconds / 3600, 2) + ' h' : '--'}</dd>
          </dl>
        </section>
        <section className="card grow">
          <header><h2>Alerts</h2>{alerts.length > 0 && <span className="count">{alerts.length}</span>}</header>
          {alerts.length === 0 ? <p className="ok-msg">All systems normal</p> : (
            <ul className="alerts">{alerts.map((a) => (
              <li key={a.code} className={a.severity}><b>{a.message}</b><small>since {hhmmss(new Date(a.ts).getTime())}</small></li>
            ))}</ul>
          )}
        </section>
      </div>

      <section className="card dark c4">
        <header><h2>Current power</h2><span className="sub">of {f(rated, 1)} kW {plant.inverter_kw ? 'inverter rating' : 'capacity'}</span></header>
        <div className="gwrap"><Gauge value={s.power_kw} max={rated} unit="kW" caption="AC power" decimals={2} dark /></div>
        <dl className="kv dk">
          <dt>Status</dt><dd className="cap">{status}</dd>
          <dt>Capacity utilisation</dt><dd>{s.power_kw != null ? f((s.power_kw / rated) * 100, 1) + ' %' : '--'}</dd>
          <dt>Peak power today</dt><dd>{td ? f(td.max_power, 2) + ' kW' : '--'}</dd>
          <dt>Energy today</dt><dd>{td ? energy(td.energy_kwh) : '--'}</dd>
          <dt>Lifetime energy</dt><dd>{live.total != null ? energy(live.total) : '--'}</dd>
        </dl>
      </section>

      <section className="card c4">
        <header><h2>Sunlight</h2><span className="sub">plane-of-array sensor</span></header>
        <div className="gwrap"><Gauge value={s.irradiance_wm2} max={1200} unit="W/m²" caption="Irradiance" decimals={0} /></div>
        <div className="tiles">
          <div><span>Panel temp</span><b>{f(s.panel_temp_c, 1)} <i>°C</i></b></div>
          <div><span>Ambient</span><b>{f(s.ambient_temp_c, 1)} <i>°C</i></b></div>
          <div><span>Irradiation</span><b>{f(ins, 2)} <i>kWh/m²</i></b></div>
        </div>
      </section>

      <section className="card c4">
        <header><h2>Electrical output</h2><span className="sub">DC strings and AC grid</span></header>
        <div className="big-tiles">
          <div><span>DC voltage</span><b>{f(s.dc_voltage_v, 0)}<i> V</i></b></div>
          <div><span>DC current</span><b>{f(s.dc_current_a, 1)}<i> A</i></b></div>
          <div><span>AC voltage</span><b>{f(s.ac_voltage_v, 0)}<i> V</i></b></div>
          <div><span>AC current</span><b>{f(s.ac_current_a, 1)}<i> A</i></b><Spark data={series.slice(-60).map((p) => p.power).filter(Number.isFinite)} /></div>
          <div><span>Frequency</span><b>{f(s.frequency_hz, 2)}<i> Hz</i></b></div>
          <div><span>Inverter efficiency</span><b>{f(s.efficiency_pct, 1)}<i> %</i></b></div>
          <div className={'wide vib ' + invSev}><span>Inverter temperature</span><b>{f(s.inverter_temp_c, 1)}<i> °C</i></b></div>
        </div>
      </section>

      <section className="card c8">
        <header>
          <h2>Power and sunlight</h2>
          <div className="seg">{[[15, '15 min'], [60, '1 hour'], [0, 'Today']].map(([m, l]) => <button key={m} className={win === m ? 'on' : ''} onClick={() => setWin(m)}>{l}</button>)}</div>
        </header>
        <div className="chart">
          {data.length === 0 ? <p className="empty">No data in this window yet.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <defs><linearGradient id="spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity=".42" /><stop offset="100%" stopColor="#f59e0b" stopOpacity=".02" /></linearGradient></defs>
                <CartesianGrid stroke="rgba(15,23,42,.08)" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} tick={{ fontSize: 11 }} minTickGap={50} />
                <YAxis yAxisId="p" domain={[0, rated]} tick={{ fontSize: 11 }} unit=" kW" width={58} />
                <YAxis yAxisId="i" orientation="right" domain={[0, 1200]} tick={{ fontSize: 11 }} unit=" W/m²" width={70} />
                <Tooltip labelFormatter={tick} formatter={(v, n) => [f(v, n === 'Power' ? 2 : 0) + (n === 'Power' ? ' kW' : ' W/m²'), n]} />
                <Area yAxisId="p" type="monotone" dataKey="power" name="Power" stroke="#d97706" strokeWidth={2.2} fill="url(#spg)" dot={false} isAnimationActive={false} />
                <Line yAxisId="i" type="monotone" dataKey="irr" name="Irradiance" stroke="#0284c7" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="card c4">
        <header><h2>Today so far</h2></header>
        <dl className="kv">
          <dt>Energy generated</dt><dd>{td ? energy(td.energy_kwh) : '--'}</dd>
          <dt>Peak power</dt><dd>{td ? f(td.max_power, 2) + ' kW' : '--'}</dd>
          <dt>Peak sun hours</dt><dd>{ins != null ? f(ins, 2) + ' h' : '--'}</dd>
          <dt>Peak irradiance</dt><dd>{td ? f(td.max_irr, 0) + ' W/m²' : '--'}</dd>
          <dt>Specific yield</dt><dd>{sy != null ? f(sy, 2) + ' kWh/kWp' : '--'}</dd>
          <dt>Performance ratio</dt><dd>{pr != null ? f(pr, 1) + ' %' : '--'}</dd>
          <dt>Panel temp avg / max</dt><dd>{td && td.ptemp_n ? `${f(td.sum_ptemp / td.ptemp_n, 1)} / ${f(td.max_ptemp, 1)} °C` : '--'}</dd>
          <dt>Generating time</dt><dd>{td ? f(td.run_seconds / 3600, 2) + ' h' : '--'}</dd>
        </dl>
      </section>
    </div>
  );
}
