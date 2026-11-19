import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import History from './History.jsx';
import Logo from './Logo.jsx';

const pt = (r) => ({ t: new Date(r.t || r.ts).getTime(), power: r.power_kw, wind: r.wind_speed, rpm: r.rotor_rpm });

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

function Shell({ user, onLogout }) {
  const [turbines, setTurbines] = useState(null);
  const [sel, setSel] = useState(Number(localStorage.getItem('zw_sel')) || null);
  const [tab, setTab] = useState('dashboard');
  const [live, setLive] = useState({});
  const [conn, setConn] = useState(false);

  useEffect(() => { api('/turbines').then((l) => { setTurbines(l); setSel((s) => (l.some((t) => t.id === s) ? s : l[0]?.id ?? null)); }); }, []);
  useEffect(() => { if (sel) localStorage.setItem('zw_sel', sel); }, [sel]);

  useEffect(() => {
    if (!sel) return;
    let dead = false;
    Promise.all([api(`/turbines/${sel}/live`), api(`/turbines/${sel}/history?minutes=60&bucket=raw`)]).then(([d, h]) => {
      if (dead) return;
      setLive((p) => ({ ...p, [sel]: { sample: d.last, ts: d.last?.ts, alerts: d.alerts, today: d.today, total: d.total_energy_kwh, online: d.online, series: h.rows.map(pt) } }));
    });
    return () => { dead = true; };
  }, [sel]);

  const onMsg = useCallback((m) => {
    if (m.type === 'ready') setConn(true);
    if (m.type === 'telemetry') setLive((p) => { const c = p[m.turbine_id] || {}; return { ...p, [m.turbine_id]: { ...c, sample: m.sample, ts: m.ts, alerts: m.alerts, today: m.today, online: true, total: (c.total || 0) + m.energy_inc, series: [...(c.series || []).slice(-1199), pt({ ...m.sample, t: m.ts })] } }; });
    if (m.type === 'status') setLive((p) => ({ ...p, [m.turbine_id]: { ...p[m.turbine_id], online: m.online, alerts: m.alerts } }));
  }, []);
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

  const turbine = turbines?.find((t) => t.id === sel);
  const lv = live[sel];
  return (
    <div className="shell">
      <header className="top">
        <div className="top-l">
          <Logo />
          {turbines && turbines.length > 0 && (
            <select className="tsel" value={sel ?? ''} onChange={(e) => setSel(Number(e.target.value))} aria-label="Turbine">
              {turbines.map((t) => <option key={t.id} value={t.id}>{`${t.name}${t.location ? ' · ' + t.location : ''} · ${t.rated_kw} kW`}</option>)}
            </select>
          )}
        </div>
        <nav className="tabs">
          <button className={tab === 'dashboard' ? 'on' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History and reports</button>
        </nav>
        <div className="top-r">
          <span className={'live ' + (conn && lv?.online ? 'on' : conn ? 'off' : '')}>{conn ? (lv?.online ? 'Live' : 'Offline') : 'Connecting'}{conn && lv?.ts ? <Ago ts={lv.ts} /> : null}</span>
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
        {turbines === null ? null : !turbine ? (
          <div className="card empty-state"><h2>No turbine yet</h2><p>Your account has no turbine assigned. Ask your administrator to assign one.</p></div>
        ) : tab === 'dashboard' ? <Dashboard key={turbine.id} turbine={turbine} live={lv} conn={conn} /> : <History key={turbine.id} turbine={turbine} tz={user.tz} />}
      </main>
    </div>
  );
}
