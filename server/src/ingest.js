import mqtt from 'mqtt';
import { q } from './db.js';
import { evaluate } from './alerts.js';
import { loadPlants, handleSolar, solarOfflineCheck, SOLAR_TOPIC } from './solar-ingest.js';

const TZ = process.env.APP_TIMEZONE || 'UTC';
const OFFLINE_MS = (Number(process.env.OFFLINE_AFTER_SECONDS) || 30) * 1000;
const NUM = ['wind_speed', 'wind_direction', 'rotor_rpm', 'power_kw', 'voltage_v', 'current_a', 'frequency_hz', 'yaw_angle', 'generator_temp_c', 'vibration_mm_s'];
const KNOWN = new Set([...NUM, 'brake', 'status', 'ts']);

const turbines = new Map(); // device_id -> turbine row
const states = new Map();   // turbine id -> { lastSeen, active: Map(code -> alert) }
let broadcast = () => {};
let lastReload = 0;

export async function loadTurbines() {
  const { rows } = await q('SELECT * FROM turbines');
  turbines.clear();
  rows.forEach((r) => turbines.set(r.device_id, r));
  lastReload = Date.now();
}

async function getState(t) {
  let st = states.get(t.id);
  if (st) return st;
  const last = await q('SELECT max(ts) AS ts FROM telemetry WHERE turbine_id=$1', [t.id]);
  const act = await q('SELECT * FROM alerts WHERE turbine_id=$1 AND active', [t.id]);
  st = { lastSeen: last.rows[0].ts ? new Date(last.rows[0].ts) : null, active: new Map(act.rows.map((a) => [a.code, a])) };
  states.set(t.id, st);
  return st;
}

const pub = (st) => [...st.active.values()].map(({ id, code, severity, part, message, value, ts }) => ({ id, code, severity, part, message, value, ts }));
export async function liveStatus(t) {
  const st = await getState(t);
  return { online: !!st.lastSeen && Date.now() - st.lastSeen.getTime() < OFFLINE_MS, alerts: pub(st), lastSeen: st.lastSeen };
}

async function raise(t, st, a, now) {
  if (st.active.has(a.code)) return;
  const r = await q('INSERT INTO alerts(turbine_id,ts,code,severity,part,message,value) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [t.id, now, a.code, a.severity, a.part, a.message, a.value]);
  st.active.set(a.code, r.rows[0]);
}
async function applyAlerts(t, st, list, now) {
  const codes = new Set(list.map((a) => a.code));
  for (const a of list) await raise(t, st, a, now);
  for (const [code, a] of st.active) {
    if (!codes.has(code)) {
      await q('UPDATE alerts SET active=false, cleared_at=$2 WHERE id=$1', [a.id, now]);
      st.active.delete(code);
    }
  }
}

async function handle(topic, buf) {
  const m = topic.match(/^zeekwind\/turbines\/([^/]+)\/telemetry$/);
  if (!m) return;
  let d;
  try { d = JSON.parse(buf.toString()); } catch { return console.warn('[ingest] invalid JSON from', m[1]); }
  if (!d || typeof d !== 'object') return;
  let t = turbines.get(m[1]);
  if (!t && Date.now() - lastReload > 10000) { await loadTurbines(); t = turbines.get(m[1]); }
  if (!t) return console.warn('[ingest] unknown device', m[1]);

  const now = new Date();
  const st = await getState(t);
  const dt = st.lastSeen ? Math.max(0.1, Math.min((now - st.lastSeen) / 1000, 15)) : 5; // cap gaps at 15 s
  st.lastSeen = now;

  const s = {};
  for (const k of NUM) s[k] = typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null;
  s.brake = typeof d.brake === 'boolean' ? d.brake : null;
  s.status = typeof d.status === 'string' ? d.status.toLowerCase().slice(0, 20) : null;
  const extra = {};
  for (const k of Object.keys(d)) if (!KNOWN.has(k)) extra[k] = d[k];
  if (d.ts) extra.device_ts = d.ts;

  const inc = (s.power_kw > 0 ? s.power_kw : 0) * dt / 3600; // kWh since previous sample
  const running = s.status ? s.status === 'running' : (s.rotor_rpm ?? 0) > 0.5;
  await q(`INSERT INTO telemetry(turbine_id,ts,wind_speed,wind_direction,rotor_rpm,power_kw,voltage_v,current_a,frequency_hz,yaw_angle,generator_temp_c,vibration_mm_s,brake,status,energy_kwh,extra)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [t.id, now, s.wind_speed, s.wind_direction, s.rotor_rpm, s.power_kw, s.voltage_v, s.current_a, s.frequency_hz, s.yaw_angle, s.generator_temp_c, s.vibration_mm_s, s.brake, s.status, inc, Object.keys(extra).length ? extra : null]);

  const day = await q(`INSERT INTO daily_summary AS d (turbine_id,day,energy_kwh,samples,sum_wind,wind_n,sum_power,max_wind,max_power,max_rpm,run_seconds)
      VALUES ($1,($2::timestamptz AT TIME ZONE $3::text)::date,$4,1,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (turbine_id,day) DO UPDATE SET
        energy_kwh=d.energy_kwh+EXCLUDED.energy_kwh, samples=d.samples+1,
        sum_wind=d.sum_wind+EXCLUDED.sum_wind, wind_n=d.wind_n+EXCLUDED.wind_n, sum_power=d.sum_power+EXCLUDED.sum_power,
        max_wind=GREATEST(d.max_wind,EXCLUDED.max_wind), max_power=GREATEST(d.max_power,EXCLUDED.max_power),
        max_rpm=GREATEST(d.max_rpm,EXCLUDED.max_rpm), run_seconds=d.run_seconds+EXCLUDED.run_seconds
      RETURNING d.*`,
    [t.id, now, TZ, inc, s.wind_speed ?? 0, s.wind_speed == null ? 0 : 1, Math.max(0, s.power_kw ?? 0), s.wind_speed ?? 0, Math.max(0, s.power_kw ?? 0), s.rotor_rpm ?? 0, running ? dt : 0]);

  await applyAlerts(t, st, evaluate(s, t), now);
  broadcast({ type: 'telemetry', turbine_id: t.id, ts: now, sample: s, energy_inc: inc, today: day.rows[0], alerts: pub(st), online: true });
}

async function offlineCheck() {
  for (const t of turbines.values()) {
    const st = await getState(t);
    if (st.lastSeen && Date.now() - st.lastSeen.getTime() > OFFLINE_MS && !st.active.has('offline')) {
      await raise(t, st, { code: 'offline', severity: 'critical', part: 'grid', message: `No data received for over ${OFFLINE_MS / 1000} s`, value: null }, new Date());
      broadcast({ type: 'status', turbine_id: t.id, online: false, alerts: pub(st) });
    }
  }
}

export function startMqtt(bc) {
  broadcast = bc;
  const c = mqtt.connect(process.env.MQTT_URL, { username: process.env.MQTT_USER, password: process.env.MQTT_PASS, reconnectPeriod: 3000 });
  c.on('connect', () => { console.log('[mqtt] connected'); c.subscribe(['zeekwind/turbines/+/telemetry', SOLAR_TOPIC], { qos: 1 }); });
  c.on('message', (topic, buf) => (topic.startsWith('zeekpower/solar/') ? handleSolar(topic, buf, broadcast) : handle(topic, buf))
    .catch((e) => console.error('[ingest]', e.message)));
  c.on('error', (e) => console.error('[mqtt]', e.message));
  setInterval(() => offlineCheck().catch((e) => console.error('[offline]', e.message)), 5000);
  setInterval(() => solarOfflineCheck(broadcast).catch((e) => console.error('[solar offline]', e.message)), 5000);
  setInterval(() => { loadTurbines().catch(() => {}); loadPlants().catch(() => {}); }, 60000);
}
