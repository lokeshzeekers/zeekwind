import { q } from './db.js';
import { evaluateSolar } from './solar-alerts.js';

const TZ = process.env.APP_TIMEZONE || 'UTC';
const OFFLINE_MS = (Number(process.env.OFFLINE_AFTER_SECONDS) || 30) * 1000;
export const SOLAR_TOPIC = 'zeekpower/solar/+/telemetry';
const NUM = ['power_kw', 'dc_power_kw', 'dc_voltage_v', 'dc_current_a', 'ac_voltage_v', 'ac_current_a', 'frequency_hz', 'power_factor',
  'irradiance_wm2', 'panel_temp_c', 'ambient_temp_c', 'inverter_temp_c', 'efficiency_pct'];
const KNOWN = new Set([...NUM, 'status', 'ts']);

const plants = new Map(); // device_id -> solar_plants row
const states = new Map(); // plant id -> { lastSeen, producing, offlineSent, active: Map(code -> alert) }
let lastReload = 0;

export async function loadPlants() {
  const { rows } = await q('SELECT * FROM solar_plants');
  plants.clear();
  rows.forEach((r) => plants.set(r.device_id, r));
  lastReload = Date.now();
}

// "producing" = the last reading says the plant was generating (or faulted). A plant that goes quiet while
// NOT producing is simply asleep (night / standby), which is normal for solar and must not raise an outage alert.
const isProducing = (s) => s.status === 'fault' || s.status === 'running' || (s.power_kw ?? 0) > 0.05 || (s.irradiance_wm2 ?? 0) >= 50;

async function getState(p) {
  let st = states.get(p.id);
  if (st) return st;
  const last = await q('SELECT ts,status,power_kw,irradiance_wm2 FROM solar_telemetry WHERE plant_id=$1 ORDER BY ts DESC LIMIT 1', [p.id]);
  const act = await q('SELECT * FROM solar_alerts WHERE plant_id=$1 AND active', [p.id]);
  const l = last.rows[0];
  st = { lastSeen: l ? new Date(l.ts) : null, producing: l ? isProducing(l) : false, offlineSent: false, active: new Map(act.rows.map((a) => [a.code, a])) };
  states.set(p.id, st);
  return st;
}

const pub = (st) => [...st.active.values()].map(({ id, code, severity, part, message, value, ts }) => ({ id, code, severity, part, message, value, ts }));
export async function solarLiveStatus(p) {
  const st = await getState(p);
  const online = !!st.lastSeen && Date.now() - st.lastSeen.getTime() < OFFLINE_MS;
  return { online, asleep: !online && !!st.lastSeen && !st.producing, alerts: pub(st), lastSeen: st.lastSeen };
}

async function raise(p, st, a, now) {
  if (st.active.has(a.code)) return;
  const r = await q('INSERT INTO solar_alerts(plant_id,ts,code,severity,part,message,value) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [p.id, now, a.code, a.severity, a.part, a.message, a.value]);
  st.active.set(a.code, r.rows[0]);
}
async function applyAlerts(p, st, list, now) {
  const codes = new Set(list.map((a) => a.code));
  for (const a of list) await raise(p, st, a, now);
  for (const [code, a] of st.active) {
    if (!codes.has(code)) {
      await q('UPDATE solar_alerts SET active=false, cleared_at=$2 WHERE id=$1', [a.id, now]);
      st.active.delete(code);
    }
  }
}

export async function handleSolar(topic, buf, broadcast) {
  const m = topic.match(/^zeekpower\/solar\/([^/]+)\/telemetry$/);
  if (!m) return;
  let d;
  try { d = JSON.parse(buf.toString()); } catch { return console.warn('[solar] invalid JSON from', m[1]); }
  if (!d || typeof d !== 'object') return;
  let p = plants.get(m[1]);
  if (!p && Date.now() - lastReload > 10000) { await loadPlants(); p = plants.get(m[1]); }
  if (!p) return console.warn('[solar] unknown device', m[1]);

  const now = new Date();
  const st = await getState(p);
  const dt = st.lastSeen ? Math.max(0.1, Math.min((now - st.lastSeen) / 1000, 15)) : 5; // cap gaps at 15 s
  st.lastSeen = now; st.offlineSent = false;

  const s = {};
  for (const k of NUM) s[k] = typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null;
  s.status = typeof d.status === 'string' ? d.status.toLowerCase().slice(0, 20) : null;
  // derive what the inverter did not send
  if (s.dc_power_kw == null && s.dc_voltage_v != null && s.dc_current_a != null) s.dc_power_kw = (s.dc_voltage_v * s.dc_current_a) / 1000;
  if (s.efficiency_pct == null && s.dc_power_kw > 0.05 && s.power_kw != null) s.efficiency_pct = Math.max(0, Math.min(100, (s.power_kw / s.dc_power_kw) * 100));
  const extra = {};
  for (const k of Object.keys(d)) if (!KNOWN.has(k)) extra[k] = d[k];
  if (d.ts) extra.device_ts = d.ts;
  st.producing = isProducing(s);

  const pw = Math.max(0, s.power_kw ?? 0);
  const inc = (pw * dt) / 3600;                                   // kWh since previous sample
  const irrWh = s.irradiance_wm2 > 0 ? (s.irradiance_wm2 * dt) / 3600 : 0; // Wh/m2 since previous sample
  const running = s.status ? s.status === 'running' : pw > 0.05;
  await q(`INSERT INTO solar_telemetry(plant_id,ts,power_kw,dc_power_kw,dc_voltage_v,dc_current_a,ac_voltage_v,ac_current_a,frequency_hz,power_factor,irradiance_wm2,panel_temp_c,ambient_temp_c,inverter_temp_c,efficiency_pct,status,energy_kwh,extra)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [p.id, now, s.power_kw, s.dc_power_kw, s.dc_voltage_v, s.dc_current_a, s.ac_voltage_v, s.ac_current_a, s.frequency_hz, s.power_factor, s.irradiance_wm2,
      s.panel_temp_c, s.ambient_temp_c, s.inverter_temp_c, s.efficiency_pct, s.status, inc, Object.keys(extra).length ? extra : null]);

  const day = await q(`INSERT INTO solar_daily_summary AS d (plant_id,day,energy_kwh,samples,sum_power,max_power,irr_wh,sum_irr,irr_n,max_irr,sum_ptemp,ptemp_n,max_ptemp,run_seconds)
      VALUES ($1,($2::timestamptz AT TIME ZONE $3::text)::date,$4,1,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (plant_id,day) DO UPDATE SET
        energy_kwh=d.energy_kwh+EXCLUDED.energy_kwh, samples=d.samples+1,
        sum_power=d.sum_power+EXCLUDED.sum_power, max_power=GREATEST(d.max_power,EXCLUDED.max_power),
        irr_wh=d.irr_wh+EXCLUDED.irr_wh, sum_irr=d.sum_irr+EXCLUDED.sum_irr, irr_n=d.irr_n+EXCLUDED.irr_n, max_irr=GREATEST(d.max_irr,EXCLUDED.max_irr),
        sum_ptemp=d.sum_ptemp+EXCLUDED.sum_ptemp, ptemp_n=d.ptemp_n+EXCLUDED.ptemp_n, max_ptemp=GREATEST(d.max_ptemp,EXCLUDED.max_ptemp),
        run_seconds=d.run_seconds+EXCLUDED.run_seconds
      RETURNING d.*`,
    [p.id, now, TZ, inc, pw, pw, irrWh, Math.max(0, s.irradiance_wm2 ?? 0), s.irradiance_wm2 == null ? 0 : 1, Math.max(0, s.irradiance_wm2 ?? 0),
      s.panel_temp_c ?? 0, s.panel_temp_c == null ? 0 : 1, s.panel_temp_c ?? 0, running ? dt : 0]);

  await applyAlerts(p, st, evaluateSolar(s, p), now);
  broadcast({ type: 'solar_telemetry', plant_id: p.id, ts: now, sample: s, energy_inc: inc, today: day.rows[0], alerts: pub(st), online: true, asleep: false });
}

export async function solarOfflineCheck(broadcast) {
  for (const p of plants.values()) {
    const st = await getState(p);
    if (!st.lastSeen || Date.now() - st.lastSeen.getTime() <= OFFLINE_MS || st.offlineSent) continue;
    st.offlineSent = true;
    if (st.producing) { // went quiet while it should be generating: a real outage
      await raise(p, st, { code: 'offline', severity: 'critical', part: 'grid', message: `No data received for over ${OFFLINE_MS / 1000} s`, value: null }, new Date());
      broadcast({ type: 'solar_status', plant_id: p.id, online: false, asleep: false, alerts: pub(st) });
    } else { // quiet and not generating: night / standby
      broadcast({ type: 'solar_status', plant_id: p.id, online: false, asleep: true, alerts: pub(st) });
    }
  }
}
