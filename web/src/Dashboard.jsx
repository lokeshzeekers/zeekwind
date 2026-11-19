import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import TurbineView from './TurbineView.jsx';
import { Gauge, Compass, withGaps } from './widgets.jsx';

const f = (v, d = 1) => (v == null || !Number.isFinite(v) ? '--' : Number(v).toFixed(d));
const hhmmss = (ms) => new Date(ms).toLocaleTimeString('en-GB');
const energy = (kwh) => (kwh >= 10000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${f(kwh, 1)} kWh`);

function useNow(ms) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}

export default function Dashboard({ turbine, live = {}, conn }) {
  const s = live.sample || {}, online = !!live.online, rated = turbine.rated_kw, td = live.today, alerts = live.alerts || [];
  const now = useNow(1000);
  const [win, setWin] = useState(15);
  const ago = live.ts ? Math.max(0, Math.round((now - new Date(live.ts).getTime()) / 1000)) : null;
  const status = !online ? 'offline' : s.status === 'fault' ? 'fault' : s.brake ? 'brake on' : s.status || (s.rotor_rpm > 0.5 ? 'running' : 'idle');
  const series = live.series || [];
  const end = series.length ? series[series.length - 1].t : now;
  const data = withGaps(series.filter((p) => p.t >= end - win * 60000), 20000);

  return (
    <div className={'grid' + (online ? '' : ' is-off')}>
      {!live.ts && <div className="banner c12">No data has been received from this turbine yet. Check the gateway connection (see the guide).</div>}
      {live.ts && !online && <div className="banner bad c12">Turbine offline. Last data {ago != null ? `${ago < 120 ? ago + ' s' : Math.round(ago / 60) + ' min'} ago` : ''}. Values shown are the last readings.</div>}
      {!conn && <div className="banner c12">Live connection lost. Reconnecting…</div>}

      <section className="card c8">
        <header><h2>{turbine.name}</h2><span className="sub">{turbine.location || turbine.device_id} · {rated} kW</span></header>
        <TurbineView sample={s} alerts={alerts} online={online} rated={rated} />
      </section>

      <div className="col c4">
        <section className="card">
          <header><h2>Status</h2><span className={'pill ' + status.replace(' ', '-')}>{status}</span></header>
          <dl className="kv">
            <dt>Last update</dt><dd>{ago == null ? '--' : `${ago} s ago`}</dd>
            <dt>Rotor speed</dt><dd>{f(s.rotor_rpm)} rpm</dd>
            <dt>Brake</dt><dd>{s.brake == null ? '--' : s.brake ? 'Engaged' : 'Released'}</dd>
            <dt>Nacelle yaw</dt><dd>{f(s.yaw_angle, 0)}°</dd>
            <dt>Run time today</dt><dd>{td ? f(td.run_seconds / 3600, 2) + ' h' : '--'}</dd>
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
        <header><h2>Power output</h2><span className="sub">of {rated} kW rated</span></header>
        <div className="gwrap"><Gauge value={s.power_kw} max={rated} unit="kW" caption="Power" decimals={1} dark /></div>
        <dl className="kv dk">
          <dt>Capacity utilisation</dt><dd>{s.power_kw != null ? f((s.power_kw / rated) * 100, 1) + ' %' : '--'}</dd>
          <dt>Energy today</dt><dd>{td ? energy(td.energy_kwh) : '--'}</dd>
          <dt>Lifetime energy</dt><dd>{live.total != null ? energy(live.total) : '--'}</dd>
        </dl>
      </section>

      <section className="card c4">
        <header><h2>Wind</h2><span className="sub">turbine anemometer</span></header>
        <div className="cwrap"><Compass dir={s.wind_direction} yaw={s.yaw_angle} /></div>
        <div className="tiles">
          <div><span>Wind speed</span><b>{f(s.wind_speed)} <i>m/s</i></b></div>
          <div><span>Wind from</span><b>{f(s.wind_direction, 0)}<i>°</i></b></div>
          <div><span>Rotor</span><b>{f(s.rotor_rpm)} <i>rpm</i></b></div>
        </div>
      </section>

      <section className="card c4">
        <header><h2>Electrical output</h2><span className="sub">generator side</span></header>
        <div className="big-tiles">
          <div><span>Voltage</span><b>{f(s.voltage_v, 0)}<i> V</i></b></div>
          <div><span>Current</span><b>{f(s.current_a, 1)}<i> A</i></b></div>
          <div><span>Frequency</span><b>{f(s.frequency_hz, 2)}<i> Hz</i></b></div>
          <div><span>Power</span><b>{f(s.power_kw, 1)}<i> kW</i></b></div>
        </div>
      </section>

      <section className="card c8">
        <header>
          <h2>Power and wind speed</h2>
          <div className="seg">{[5, 15, 60].map((m) => <button key={m} className={win === m ? 'on' : ''} onClick={() => setWin(m)}>{m} min</button>)}</div>
        </header>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f7fe0" stopOpacity=".45" /><stop offset="100%" stopColor="#4f7fe0" stopOpacity=".02" /></linearGradient></defs>
              <CartesianGrid stroke="rgba(15,26,43,.1)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={hhmmss} tick={{ fontSize: 11 }} minTickGap={50} />
              <YAxis yAxisId="p" domain={[0, rated]} tick={{ fontSize: 11 }} unit=" kW" width={58} />
              <YAxis yAxisId="w" orientation="right" domain={[0, 'auto']} tick={{ fontSize: 11 }} unit=" m/s" width={58} />
              <Tooltip labelFormatter={hhmmss} formatter={(v, n) => [f(v, 1) + (n === 'Power' ? ' kW' : ' m/s'), n]} />
              <Area yAxisId="p" dataKey="power" name="Power" stroke="#4f7fe0" strokeWidth={2} fill="url(#pg)" dot={false} isAnimationActive={false} />
              <Line yAxisId="w" dataKey="wind" name="Wind speed" stroke="#0f1a2b" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card c4">
        <header><h2>Today so far</h2></header>
        <dl className="kv">
          <dt>Energy produced</dt><dd>{td ? energy(td.energy_kwh) : '--'}</dd>
          <dt>Average wind</dt><dd>{td && td.wind_n ? f(td.sum_wind / td.wind_n) + ' m/s' : '--'}</dd>
          <dt>Peak wind</dt><dd>{td ? f(td.max_wind) + ' m/s' : '--'}</dd>
          <dt>Peak power</dt><dd>{td ? f(td.max_power) + ' kW' : '--'}</dd>
          <dt>Peak rotor speed</dt><dd>{td ? f(td.max_rpm) + ' rpm' : '--'}</dd>
          <dt>Run time</dt><dd>{td ? f(td.run_seconds / 3600, 2) + ' h' : '--'}</dd>
        </dl>
      </section>
    </div>
  );
}
