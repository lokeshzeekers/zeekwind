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
      <div className="login-art">
        <Logo size={44} light />
        <h1>Know what your turbine is doing, as it happens.</h1>
        <p>Live power, rotor speed, wind and alerts for your wind turbines, with every day recorded for review.</p>
      </div>
      <form className="login-form card" onSubmit={submit}>
        <h2>Sign in</h2>
        <label>Username<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></label>
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div className="form-err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <small>Need access? Ask your ZeekWind administrator.</small>
      </form>
    </main>
  );
}
