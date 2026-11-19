import { useState } from 'react';
import { api, setToken } from './api.js';
import Logo from './Logo.jsx';

export default function Login({ onLogin }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api('/auth/login', { method: 'POST', body: { username: u, password: p } }); setToken(r.token); onLogin(r.user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <main className="login">
      <img className="login-hero" src="/turbine.jpg" alt="" aria-hidden="true" />
      <svg className="login-bg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <g fill="none" stroke="rgba(100,116,139,.16)" strokeWidth="1.2">
          <path d="M0 700C220 640 420 740 700 690S1160 610 1440 680" />
          <path d="M0 750C240 700 440 790 720 740S1180 670 1440 735" />
          <path d="M0 800C260 760 460 840 740 795S1200 730 1440 790" />
          <path d="M0 850C280 820 480 885 760 850S1220 795 1440 845" />
        </g>
      </svg>
      <div className="login-col">
        <form className="login-form card" onSubmit={submit}>
          <Logo size={44} />
          <h2>Sign in</h2>
          <p className="login-lead">Know what your turbine is doing, as it happens.</p>
          <label>Username<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></label>
          <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></label>
          {err && <div className="form-err" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <small>Need access? Ask your ZeekWind administrator.</small>
        </form>
        <p className="login-tag">Live power, rotor speed, wind and alerts for your wind turbines, with every day recorded for review.</p>
      </div>
    </main>
  );
}
