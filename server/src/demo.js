// Demo/fake history so dashboards and History pages can be seen without real hardware.
// Every fake row is tagged extra->>'demo' = 'true' so clear-demo removes exactly those and nothing real.
import { q } from './db.js';

const TZ = process.env.APP_TIMEZONE || 'UTC';
const STEP = 300; // seconds between fake samples (5 min)
const r = (v, d = 2) => +v.toFixed(d);
const noise = (a) => (Math.random() - 0.5) * 2 * a;

// insert many rows at once: cols = [[name, pgType], ...], rows = array of arrays
async function bulk(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const arrays = cols.map((_, c) => chunk.map((row) => row[c]));
    await q(`INSERT INTO ${table}(${cols.map((c) => c[0]).join(',')}) SELECT * FROM unnest(${cols.map((c, k) => `$${k + 1}::${c[1]}[]`).join(',')})`, arrays);
  }
}

// midnight (local, APP_TIMEZONE) of the day that is `back` days before today, as a Date
async function dayStart(back) {
  const { rows } = await q(`SELECT (((now() AT TIME ZONE $1::text)::date - $2::int)::timestamp AT TIME ZONE $1::text) AS t, ((now() AT TIME ZONE $1::text)::date - $2::int)::text AS d`, [TZ, back]);
  return { t: new Date(rows[0].t), d: rows[0].d };
}
async function dayHasData(table, idCol, id, day) {
  return (await q(`SELECT 1 FROM ${table} WHERE ${idCol}=$1 AND (ts AT TIME ZONE $2::text)::date=$3::date LIMIT 1`, [id, TZ, day])).rowCount > 0;
}

async function seedSolar(p, days) {
  const cap = p.capacity_kwp, inv = p.inverter_kw || cap, tel = [], sums = [];
  let skipped = 0;
  for (let back = days; back >= 1; back--) {
    const { t: t0, d } = await dayStart(back);
    if (await dayHasData('solar_telemetry', 'plant_id', p.id, d)) { skipped++; continue; }
    const cloud = 0.45 + Math.random() * 0.55, amb0 = 22 + Math.random() * 6;
    const day = { e: 0, n: 0, sp: 0, mp: 0, wh: 0, si: 0, ni: 0, mi: 0, st: 0, nt: 0, mt: 0, run: 0 };
    let wob = 1;
    for (let k = 0; k < 86400 / STEP; k++) {
      const h = (k * STEP) / 3600;
      const sun = h > 6 && h < 18.5 ? Math.sin((Math.PI * (h - 6)) / 12.5) : 0;
      wob = Math.max(0.35, Math.min(1, wob + noise(0.12)));              // passing clouds
      const irr = sun > 0 ? Math.max(0, 1000 * Math.pow(sun, 1.15) * cloud * (0.35 + 0.65 * wob)) : 0;
      const amb = amb0 + 9 * Math.max(0, Math.sin((Math.PI * (h - 8)) / 12)) + noise(0.4);
      const pt = amb + irr * 0.028;
      const ac = Math.min(inv, Math.max(0, (cap * irr / 1000) * (0.84 - 0.0035 * (pt - 25)) * (0.97 + Math.random() * 0.03)));
      const dc = ac > 0 ? ac / 0.975 : 0, vdc = irr > 20 ? 560 - (pt - 25) * 1.1 + noise(3) : 0;
      const status = ac > 0.05 ? 'running' : 'standby';
      const inc = (ac * STEP) / 3600, ts = new Date(t0.getTime() + k * STEP * 1000);
      tel.push([ts.toISOString(), r(ac), r(dc), r(vdc, 1), vdc > 0 ? r((dc * 1000) / vdc, 1) : 0, r(398 + noise(3), 1), r((ac * 1000) / (Math.sqrt(3) * 398 * 0.99), 1), r(50 + noise(0.04)), r(0.97 + noise(0.015), 3),
        r(irr, 0), r(pt, 1), r(amb, 1), r(amb + 8 + (ac / inv) * 22, 1), dc > 0.05 ? r((ac / dc) * 100, 1) : null, status, inc, JSON.stringify({ demo: true })]);
      day.e += inc; day.n++; day.sp += ac; day.mp = Math.max(day.mp, ac); day.wh += (irr * STEP) / 3600;
      day.si += irr; day.ni++; day.mi = Math.max(day.mi, irr); day.st += pt; day.nt++; day.mt = Math.max(day.mt, pt); if (ac > 0.05) day.run += STEP;
    }
    sums.push([p.id, d, day.e, day.n, day.sp, day.mp, day.wh, day.si, day.ni, day.mi, day.st, day.nt, day.mt, day.run]);
  }
  await bulk('solar_telemetry', [['plant_id', 'int'], ['ts', 'timestamptz'], ['power_kw', 'float8'], ['dc_power_kw', 'float8'], ['dc_voltage_v', 'float8'], ['dc_current_a', 'float8'], ['ac_voltage_v', 'float8'], ['ac_current_a', 'float8'],
    ['frequency_hz', 'float8'], ['power_factor', 'float8'], ['irradiance_wm2', 'float8'], ['panel_temp_c', 'float8'], ['ambient_temp_c', 'float8'], ['inverter_temp_c', 'float8'], ['efficiency_pct', 'float8'], ['status', 'text'], ['energy_kwh', 'float8'], ['extra', 'jsonb']],
  tel.map((x) => [p.id, ...x]));
  await bulk('solar_daily_summary', [['plant_id', 'int'], ['day', 'date'], ['energy_kwh', 'float8'], ['samples', 'int'], ['sum_power', 'float8'], ['max_power', 'float8'], ['irr_wh', 'float8'], ['sum_irr', 'float8'], ['irr_n', 'int'], ['max_irr', 'float8'], ['sum_ptemp', 'float8'], ['ptemp_n', 'int'], ['max_ptemp', 'float8'], ['run_seconds', 'float8']], sums);
  return `Solar plant "${p.name}": added ${sums.length} fake day(s) (${tel.length} readings)${skipped ? `, skipped ${skipped} day(s) that already have data` : ''}. Remove with: clear-demo ${p.device_id} --yes`;
}

async function seedWind(t, days) {
  const rated = t.rated_kw, tel = [], sums = [];
  const curve = (w) => (w < 3 || w > 25 ? 0 : w >= 11 ? rated : rated * ((w - 3) / 8) ** 3); // illustrative test curve only
  let skipped = 0;
  for (let back = days; back >= 1; back--) {
    const { t: t0, d } = await dayStart(back);
    if (await dayHasData('telemetry', 'turbine_id', t.id, d)) { skipped++; continue; }
    const base = 4 + Math.random() * 5, day = { e: 0, n: 0, sw: 0, wn: 0, sp: 0, mw: 0, mp: 0, mr: 0, run: 0 };
    let w = base, dir = 200 + Math.random() * 80;
    for (let k = 0; k < 86400 / STEP; k++) {
      const h = (k * STEP) / 3600;
      w = Math.max(0, Math.min(26, w + noise(1.1) + (base + 2 * Math.sin((Math.PI * (h - 4)) / 12) - w) * 0.15));
      dir = (dir + noise(8) + 360) % 360;
      const p = curve(w) * (0.95 + Math.random() * 0.05), rpm = p > 0 ? Math.min(200, w * 17) : w > 1 ? 4 : 0, inc = (p * STEP) / 3600;
      const ts = new Date(t0.getTime() + k * STEP * 1000);
      tel.push([t.id, ts.toISOString(), r(w), r(dir, 0), r(rpm, 1), r(p), r(400 + noise(3), 1), r((p * 1000) / (Math.sqrt(3) * 400 * 0.95), 1), r(50 + noise(0.05)), r(dir, 0), p > 0 ? 'running' : 'idle', inc, JSON.stringify({ demo: true })]);
      day.e += inc; day.n++; day.sw += w; day.wn++; day.sp += p; day.mw = Math.max(day.mw, w); day.mp = Math.max(day.mp, p); day.mr = Math.max(day.mr, rpm); if (p > 0) day.run += STEP;
    }
    sums.push([t.id, d, day.e, day.n, day.sw, day.wn, day.sp, day.mw, day.mp, day.mr, day.run]);
  }
  await bulk('telemetry', [['turbine_id', 'int'], ['ts', 'timestamptz'], ['wind_speed', 'float8'], ['wind_direction', 'float8'], ['rotor_rpm', 'float8'], ['power_kw', 'float8'], ['voltage_v', 'float8'], ['current_a', 'float8'], ['frequency_hz', 'float8'], ['yaw_angle', 'float8'], ['status', 'text'], ['energy_kwh', 'float8'], ['extra', 'jsonb']], tel);
  await bulk('daily_summary', [['turbine_id', 'int'], ['day', 'date'], ['energy_kwh', 'float8'], ['samples', 'int'], ['sum_wind', 'float8'], ['wind_n', 'int'], ['sum_power', 'float8'], ['max_wind', 'float8'], ['max_power', 'float8'], ['max_rpm', 'float8'], ['run_seconds', 'float8']], sums);
  return `Wind turbine "${t.name}": added ${sums.length} fake day(s) (${tel.length} readings)${skipped ? `, skipped ${skipped} day(s) that already have data` : ''}. Remove with: clear-demo ${t.device_id} --yes`;
}

export async function seedDemo(device, days) {
  const p = (await q('SELECT * FROM solar_plants WHERE device_id=$1', [device])).rows[0];
  if (p) return seedSolar(p, days);
  const t = (await q('SELECT * FROM turbines WHERE device_id=$1', [device])).rows[0];
  if (t) return seedWind(t, days);
  throw new Error(`No turbine or solar plant with device id "${device}". Check with: list`);
}

export async function clearDemo(device) {
  const p = (await q('SELECT * FROM solar_plants WHERE device_id=$1', [device])).rows[0];
  if (p) {
    const a = await q(`DELETE FROM solar_telemetry WHERE plant_id=$1 AND extra->>'demo'='true'`, [p.id]);
    const b = await q(`DELETE FROM solar_daily_summary s WHERE plant_id=$1 AND NOT EXISTS (SELECT 1 FROM solar_telemetry x WHERE x.plant_id=s.plant_id AND (x.ts AT TIME ZONE $2::text)::date=s.day)`, [p.id, TZ]);
    return `Removed ${a.rowCount} fake readings and ${b.rowCount} day summaries from solar plant "${p.name}".`;
  }
  const t = (await q('SELECT * FROM turbines WHERE device_id=$1', [device])).rows[0];
  if (t) {
    const a = await q(`DELETE FROM telemetry WHERE turbine_id=$1 AND extra->>'demo'='true'`, [t.id]);
    const b = await q(`DELETE FROM daily_summary s WHERE turbine_id=$1 AND NOT EXISTS (SELECT 1 FROM telemetry x WHERE x.turbine_id=s.turbine_id AND (x.ts AT TIME ZONE $2::text)::date=s.day)`, [t.id, TZ]);
    return `Removed ${a.rowCount} fake readings and ${b.rowCount} day summaries from turbine "${t.name}".`;
  }
  throw new Error(`No turbine or solar plant with device id "${device}".`);
}
