import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { q, migrate } from './db.js';
import { loadTurbines, startMqtt, liveStatus } from './ingest.js';
import { loadPlants } from './solar-ingest.js';
import { solarApi } from './solar-api.js';

const TZ = process.env.APP_TIMEZONE || 'UTC';
const CO2 = Number(process.env.CO2_KG_PER_KWH) || 0.82; // kg CO2 avoided per kWh of solar (grid emission factor, India CEA ~0.82)
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('JWT_SECRET missing or too short'); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'", 'ws:', 'wss:'], upgradeInsecureRequests: null } } }));
app.use(express.json({ limit: '50kb' }));

// ---------- auth ----------
const sign = (u) => jwt.sign({ id: u.id, role: u.role, username: u.username }, SECRET, { expiresIn: '12h' });
const attempts = new Map();
function limited(ip) {
  const now = Date.now(), a = attempts.get(ip);
  if (!a || a.reset < now) { attempts.set(ip, { n: 1, reset: now + 15 * 60000 }); return false; }
  return ++a.n > 10;
}
app.post('/api/auth/login', async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { username = '', password = '' } = req.body || {};
  const { rows } = await q('SELECT * FROM users WHERE username=$1', [String(username).trim().toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(password), u.password_hash))) return res.status(401).json({ error: 'Wrong username or password.' });
  attempts.delete(req.ip);
  res.json({ token: sign(u), user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, tz: TZ, co2: CO2 } });
});
function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Not signed in' }); }
}
app.get('/api/me', auth, async (req, res) => {
  const { rows } = await q('SELECT id,username,full_name,role FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Not signed in' });
  res.json({ ...rows[0], tz: TZ, co2: CO2 });
});

// ---------- turbines ----------
async function myTurbines(u) {
  const sql = u.role === 'admin' ? 'SELECT * FROM turbines ORDER BY name'
    : 'SELECT t.* FROM turbines t JOIN user_turbines ut ON ut.turbine_id=t.id WHERE ut.user_id=$1 ORDER BY t.name';
  return (await q(sql, u.role === 'admin' ? [] : [u.id])).rows;
}
async function guard(req, res, next) {
  const t = (await myTurbines(req.user)).find((x) => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Turbine not found' });
  req.turbine = t; next();
}
app.get('/api/turbines', auth, async (req, res) => {
  const list = await myTurbines(req.user);
  res.json(await Promise.all(list.map(async (t) => ({ id: t.id, device_id: t.device_id, name: t.name, location: t.location, rated_kw: t.rated_kw, limits: t.limits, ...(await liveStatus(t)) }))));
});
app.get('/api/turbines/:id/live', auth, guard, async (req, res) => {
  const t = req.turbine;
  const [last, today, total, st] = await Promise.all([
    q('SELECT * FROM telemetry WHERE turbine_id=$1 ORDER BY ts DESC LIMIT 1', [t.id]),
    q('SELECT * FROM daily_summary WHERE turbine_id=$1 AND day=(now() AT TIME ZONE $2::text)::date', [t.id, TZ]),
    q('SELECT COALESCE(sum(energy_kwh),0) AS e FROM daily_summary WHERE turbine_id=$1', [t.id]),
    liveStatus(t)]);
  res.json({ last: last.rows[0] || null, today: today.rows[0] || null, total_energy_kwh: total.rows[0].e, online: st.online, alerts: st.alerts });
});

// date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD (days in APP_TIMEZONE) or ?minutes=N
async function bounds(req) {
  if (req.query.minutes) {
    const m = Math.min(Math.max(Number(req.query.minutes) || 15, 1), 1440);
    return [new Date(Date.now() - m * 60000), new Date(Date.now() + 60000)];
  }
  const { from, to } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw Object.assign(new Error('from and to must be YYYY-MM-DD'), { status: 400 });
  const { rows } = await q(`SELECT ($1::date)::timestamp AT TIME ZONE $3::text AS a, (($2::date)+1)::timestamp AT TIME ZONE $3::text AS b`, [from, to, TZ]);
  return [rows[0].a, rows[0].b];
}
const bucketOf = (b) => (b === 'raw' || !b ? 'raw' : Math.max(10, Number(b) || 60));
const AGG = `avg(wind_speed) AS wind_speed, avg(power_kw) AS power_kw, max(power_kw) AS power_max, avg(rotor_rpm) AS rotor_rpm,
  avg(voltage_v) AS voltage_v, avg(current_a) AS current_a, avg(frequency_hz) AS frequency_hz, sum(energy_kwh) AS energy_kwh`;

app.get('/api/turbines/:id/history', auth, guard, async (req, res) => {
  const [a, b] = await bounds(req);
  const bk = bucketOf(req.query.bucket), LIMIT = 20000;
  const { rows } = bk === 'raw'
    ? await q(`SELECT ts AS t, wind_speed, wind_direction, rotor_rpm, power_kw, voltage_v, current_a, frequency_hz, yaw_angle, vibration_mm_s, energy_kwh
               FROM telemetry WHERE turbine_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts DESC LIMIT ${LIMIT}`, [req.turbine.id, a, b])
    : await q(`SELECT date_bin(($4 || ' seconds')::interval, ts, '2000-01-01'::timestamptz) AS t, ${AGG}
               FROM telemetry WHERE turbine_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1 ORDER BY 1 DESC LIMIT ${LIMIT}`, [req.turbine.id, a, b, String(bk)]);
  rows.reverse();
  res.json({ bucket: bk, truncated: rows.length >= LIMIT, rows });
});
app.get('/api/turbines/:id/daily', auth, guard, async (req, res) => {
  const { from, to } = req.query;
  const { rows } = await q('SELECT * FROM daily_summary WHERE turbine_id=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day', [req.turbine.id, from, to]);
  res.json({ rows });
});
app.get('/api/turbines/:id/alerts', auth, guard, async (req, res) => {
  const [a, b] = await bounds(req);
  const { rows } = await q('SELECT id,ts,code,severity,part,message,value,active,cleared_at FROM alerts WHERE turbine_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts DESC LIMIT 1000', [req.turbine.id, a, b]);
  res.json({ rows });
});

// ---------- solar plants (separate from wind) ----------
const solar = solarApi(auth, TZ);
app.use('/api', solar.router);

// ---------- CSV export ----------
const cell = (v) => v == null ? '' : v instanceof Date ? v.toISOString() : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const line = (cols, r) => cols.map((c) => cell(r[c])).join(',') + '\n';
app.get('/api/turbines/:id/export', auth, guard, async (req, res) => {
  const type = req.query.type || 'telemetry';
  const id = req.turbine.id;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.turbine.device_id}_${type}_${req.query.from || 'recent'}_${req.query.to || ''}.csv"`);
  if (type === 'daily') {
    const cols = ['day', 'energy_kwh', 'avg_wind_ms', 'max_wind_ms', 'avg_power_kw', 'peak_power_kw', 'max_rpm', 'run_hours', 'capacity_factor_pct', 'samples'];
    res.write(cols.join(',') + '\n');
    const { rows } = await q(`SELECT day, energy_kwh, CASE WHEN wind_n>0 THEN sum_wind/wind_n END AS avg_wind_ms, max_wind AS max_wind_ms,
      CASE WHEN samples>0 THEN sum_power/samples END AS avg_power_kw, max_power AS peak_power_kw, max_rpm, run_seconds/3600 AS run_hours,
      energy_kwh/($4*24)*100 AS capacity_factor_pct, samples FROM daily_summary WHERE turbine_id=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day`,
      [id, req.query.from, req.query.to, req.turbine.rated_kw]);
    rows.forEach((r) => res.write(line(cols, r)));
    return res.end();
  }
  const [a, b] = await bounds(req);
  if (type === 'alerts') {
    const cols = ['ts', 'severity', 'code', 'part', 'message', 'value', 'active', 'cleared_at'];
    res.write(cols.join(',') + '\n');
    const { rows } = await q('SELECT * FROM alerts WHERE turbine_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts', [id, a, b]);
    rows.forEach((r) => res.write(line(cols, r)));
    return res.end();
  }
  const bk = bucketOf(req.query.bucket);
  if (bk !== 'raw') {
    const cols = ['ts_local', 'ts_utc', 'wind_speed', 'power_kw', 'power_max', 'rotor_rpm', 'voltage_v', 'current_a', 'frequency_hz', 'energy_kwh'];
    res.write(cols.join(',') + '\n');
    const { rows } = await q(`SELECT to_char(t AT TIME ZONE $5::text,'YYYY-MM-DD HH24:MI:SS') AS ts_local, t AS ts_utc, * FROM (
      SELECT date_bin(($4 || ' seconds')::interval, ts, '2000-01-01'::timestamptz) AS t, ${AGG} FROM telemetry WHERE turbine_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1) x ORDER BY t`, [id, a, b, String(bk), TZ]);
    rows.forEach((r) => res.write(line(cols, r)));
    return res.end();
  }
  const cols = ['ts_local', 'ts_utc', 'wind_speed', 'wind_direction', 'rotor_rpm', 'power_kw', 'voltage_v', 'current_a', 'frequency_hz', 'yaw_angle', 'generator_temp_c', 'vibration_mm_s', 'brake', 'status', 'energy_kwh', 'extra'];
  res.write(cols.join(',') + '\n');
  let last = 0;
  for (;;) {
    const { rows } = await q(`SELECT id, to_char(ts AT TIME ZONE $5::text,'YYYY-MM-DD HH24:MI:SS') AS ts_local, ts AS ts_utc, wind_speed, wind_direction, rotor_rpm, power_kw, voltage_v, current_a, frequency_hz, yaw_angle, generator_temp_c, vibration_mm_s, brake, status, energy_kwh, extra::text AS extra
      FROM telemetry WHERE turbine_id=$1 AND ts>=$2 AND ts<$3 AND id>$4 ORDER BY id LIMIT 10000`, [id, a, b, last, TZ]);
    if (!rows.length) break;
    res.write(rows.map((r) => line(cols, r)).join(''));
    last = rows[rows.length - 1].id;
  }
  res.end();
});

// ---------- static frontend ----------
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
if (fs.existsSync(pub)) {
  app.use(express.static(pub));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(pub, 'index.html')) : next()));
}
app.use((err, req, res, next) => { // eslint-disable-line
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

// ---------- websocket (live push) ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();
wss.on('connection', (ws) => {
  const c = { ws, ids: null, sids: null, alive: true };
  const kill = setTimeout(() => !c.ids && ws.close(), 5000);
  ws.on('pong', () => { c.alive = true; });
  ws.on('close', () => { clearTimeout(kill); clients.delete(c); });
  ws.on('message', async (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type !== 'auth') return;
      const u = jwt.verify(m.token, SECRET);
      c.ids = new Set((await myTurbines(u)).map((t) => t.id));
      c.sids = new Set((await solar.myPlants(u)).map((p) => p.id));
      clients.add(c);
      ws.send(JSON.stringify({ type: 'ready' }));
    } catch { ws.close(); }
  });
});
setInterval(() => clients.forEach((c) => { if (!c.alive) return c.ws.terminate(); c.alive = false; c.ws.ping(); }), 30000);
// wind messages carry turbine_id, solar messages carry plant_id; each client only gets what it is assigned
const broadcast = (msg) => {
  const s = JSON.stringify(msg);
  clients.forEach((c) => (msg.plant_id != null ? c.sids.has(msg.plant_id) : c.ids.has(msg.turbine_id)) && c.ws.readyState === 1 && c.ws.send(s));
};

await migrate();
await loadTurbines();
await loadPlants();
startMqtt(broadcast);
server.listen(Number(process.env.PORT) || 3000, () => console.log('Zeek Power server on :' + (process.env.PORT || 3000)));
