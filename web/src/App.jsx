import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import History from './History.jsx';
import SolarDashboard from './SolarDashboard.jsx';
import SolarHistory from './SolarHistory.jsx';
import Logo from './Logo.jsx';

// Wind and solar are two separate fleets: own list, own live data, own history. A user sees only what the admin assigned.
const FLEET = {
  wind: {
    base: '/turbines', idKey: 'turbine_id', tel: 'telemetry', stat: 'status', selKey: 'zw_sel', noun: 'turbine',
    pt: (r) => ({ t: new Date(r.t || r.ts).getTime(), power: r.power_kw, wind: r.wind_speed, rpm: r.rotor_rpm }),
    init: (d, series) => ({ sample: d.last, ts: d.last?.ts, alerts: d.alerts, today: d.today, total: d.total_energy_kwh, online: d.online, series }),
    label: (t) => `${t.name}${t.location ? ' · ' + t.location : ''} · ${t.rated_kw} kW`,
  },
  solar: {
    base: '/solar', idKey: 'plant_id', tel: 'solar_telemetry', stat: 'solar_status', selKey: 'zp_sel_solar', noun: 'solar plant',
    pt: (r) => ({ t: new Date(r.t || r.ts).getTime(), power: r.power_kw, irr: r.irradiance_wm2 }),
    init: (d, series) => ({ sample: d.last, ts: d.last?.ts, alerts: d.alerts, today: d.today, total: d.total_energy_kwh, month: d.month_energy_kwh, todayDate: d.today_date, online: d.online, asleep: d.asleep, series }),
    label: (p) => `${p.name}${p.location ? ' · ' + p.location : ''} · ${p.capacity_kwp} kWp`,
  },
};

function useFleet(kind) {
  const c = FLEET[kind];
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(Number(localStorage.getItem(c.selKey)) || null);
  const [live, setLive] = useState({});

  useEffect(() => { api(c.base).then((l) => { setList(l); setSel((s) => (l.some((x) => x.id === s) ? s : l[0]?.id ?? null)); }).catch(() => setList([])); }, [c.base]);
  useEffect(() => { if (sel) localStorage.setItem(c.selKey, sel); }, [sel, c.selKey]);
  useEffect(() => {
    if (!sel) return undefined;
    let dead = false;
    Promise.all([api(`${c.base}/${sel}/live`), api(`${c.base}/${sel}/history?minutes=60&bucket=raw`)]).then(([d, h]) => {
      if (dead) return;
      setLive((p) => ({ ...p, [sel]: c.init(d, h.rows.map(c.pt)) }));
    }).catch(() => {});
    return () => { dead = true; };
  }, [sel, c]);

  const onMsg = useCallback((m) => {
    const id = m[c.idKey];
    if (m.type === c.tel) setLive((p) => { const cur = p[id] || {}; return { ...p, [id]: { ...cur, sample: m.sample, ts: m.ts, alerts: m.alerts, today: m.today, online: true, asleep: false, total: (cur.total || 0) + m.energy_inc, ...(kind === 'solar' ? { month: (cur.month || 0) + m.energy_inc } : {}), series: [...(cur.series || []).slice(-1199), c.pt({ ...m.sample, t: m.ts })] } }; });
    if (m.type === c.stat) setLive((p) => ({ ...p, [id]: { ...p[id], online: m.online, asleep: !!m.asleep, alerts: m.alerts } }));
  }, [c, kind]);

  return { list, sel, setSel, live, onMsg, count: list ? list.length : null };
}

export default function App() {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false);
  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('zw-logout', out);
    if (!getToken()) setReady(true);
    else api('/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
    return () => window.removeEventListener('zw-logout', out);
  }, []);
  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;
  return <Shell user={user} onLogout={() => { setToken(null); setUser(null); }} />;
}

function Ago({ ts }) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(i); }, []);
  return <em className="ago">{Math.max(0, Math.round((n - new Date(ts).getTime()) / 1000))}s ago</em>;
}

const WindIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.6 4.6A2 2 0 1 1 11 8H2" /><path d="M12.6 19.4A2 2 0 1 0 14 16H2" /><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2" /></svg>;
const SunIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;

function Shell({ user, onLogout }) {
  const fleets = { wind: useFleet('wind'), solar: useFleet('solar') };
  const [mode, setMode] = useState(localStorage.getItem('zp_mode') || 'wind');
  const [tab, setTab] = useState('dashboard');
  const [conn, setConn] = useState(false);

  const { onMsg: windMsg } = fleets.wind, { onMsg: solarMsg } = fleets.solar;
  const onMsg = useCallback((m) => { if (m.type === 'ready') setConn(true); windMsg(m); solarMsg(m); }, [windMsg, solarMsg]);
  useEffect(() => {
    let ws, stop = false, timer;
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
      ws.onmessage = (e) => onMsg(JSON.parse(e.data));
      ws.onclose = () => { setConn(false); if (!stop) timer = setTimeout(open, 3000); };
    };
    open();
    return () => { stop = true; clearTimeout(timer); ws && ws.close(); };
  }, [onMsg]);

  const loaded = fleets.wind.list !== null && fleets.solar.list !== null;
  const has = { wind: fleets.wind.count > 0, solar: fleets.solar.count > 0 };
  const both = has.wind && has.solar;
  const active = has[mode] ? mode : has.wind ? 'wind' : has.solar ? 'solar' : null; // never land on a side the user does not have
  const pick = (m) => { setMode(m); localStorage.setItem('zp_mode', m); };
  const fl = active ? fleets[active] : null;
  const plant = fl?.list?.find((x) => x.id === fl.sel);
  const lv = fl ? fl.live[fl.sel] : null;
  const showOnline = active === 'solar' && lv?.asleep ? 'Standby' : lv?.online ? 'Live' : 'Offline';

  return (
    <div className="shell">
      <header className="top">
        <div className="top-l">
          <Logo />
          {both && (
            <div className="modes" role="tablist" aria-label="Power source">
              <button role="tab" aria-selected={active === 'wind'} className={active === 'wind' ? 'on' : ''} onClick={() => pick('wind')}><WindIcon />Wind</button>
              <button role="tab" aria-selected={active === 'solar'} className={active === 'solar' ? 'on' : ''} onClick={() => pick('solar')}><SunIcon />Solar</button>
            </div>
          )}
          {fl && fl.list.length > 0 && (
            <select className="tsel" value={fl.sel ?? ''} onChange={(e) => fl.setSel(Number(e.target.value))} aria-label={active === 'solar' ? 'Solar plant' : 'Turbine'}>
              {fl.list.map((x) => <option key={x.id} value={x.id}>{FLEET[active].label(x)}</option>)}
            </select>
          )}
        </div>
        <nav className="tabs">
          <button className={tab === 'dashboard' ? 'on' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History and reports</button>
        </nav>
        <div className="top-r">
          <span className={'live ' + (conn && lv?.online ? 'on' : conn && !lv?.asleep ? 'off' : '')}>{conn ? showOnline : 'Connecting'}{conn && lv?.ts ? <Ago ts={lv.ts} /> : null}</span>
          <div className="user">
            <span className="avatar" aria-hidden="true">{(user.full_name || user.username || '?').trim().charAt(0).toUpperCase()}</span>
            <span className="uname">{user.full_name || user.username}</span>
            <button onClick={onLogout} aria-label="Sign out" title="Sign out">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
            </button>
          </div>
        </div>
      </header>
      <main className="page">
        {!loaded ? null : !active || !plant ? (
          <div className="card empty-state"><h2>Nothing assigned yet</h2><p>Your account has no wind turbine or solar plant assigned. Ask your administrator to assign one.</p></div>
        ) : active === 'wind'
          ? tab === 'dashboard' ? <Dashboard key={'w' + plant.id} turbine={plant} live={lv} conn={conn} /> : <History key={'w' + plant.id} turbine={plant} tz={user.tz} />
          : tab === 'dashboard' ? <SolarDashboard key={'s' + plant.id} plant={plant} live={lv} conn={conn} co2Factor={user.co2 ?? 0.82} /> : <SolarHistory key={'s' + plant.id} plant={plant} tz={user.tz} />}
      </main>
    </div>
  );
}
