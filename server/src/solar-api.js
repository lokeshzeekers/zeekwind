import express from 'express';
import { q } from './db.js';
import { solarLiveStatus } from './solar-ingest.js';

const cell = (v) => v == null ? '' : v instanceof Date ? v.toISOString() : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const line = (cols, r) => cols.map((c) => cell(r[c])).join(',') + '\n';
const bucketOf = (b) => (b === 'raw' || !b ? 'raw' : Math.max(10, Number(b) || 60));
const AGG = `avg(power_kw) AS power_kw, max(power_kw) AS power_max, avg(irradiance_wm2) AS irradiance_wm2, avg(panel_temp_c) AS panel_temp_c,
  avg(ambient_temp_c) AS ambient_temp_c, avg(inverter_temp_c) AS inverter_temp_c, avg(dc_voltage_v) AS dc_voltage_v, avg(dc_current_a) AS dc_current_a,
  avg(ac_voltage_v) AS ac_voltage_v, avg(ac_current_a) AS ac_current_a, avg(frequency_hz) AS frequency_hz, avg(efficiency_pct) AS efficiency_pct, sum(energy_kwh) AS energy_kwh`;

// Every route here is for SOLAR plants only. Wind turbines stay on /api/turbines.
export function solarApi(auth, TZ) {
  const r = express.Router();

  async function myPlants(u) {
    const sql = u.role === 'admin' ? 'SELECT * FROM solar_plants ORDER BY name'
      : 'SELECT p.* FROM solar_plants p JOIN user_solar_plants up ON up.plant_id=p.id WHERE up.user_id=$1 ORDER BY p.name';
    return (await q(sql, u.role === 'admin' ? [] : [u.id])).rows;
  }
  async function guard(req, res, next) {
    const p = (await myPlants(req.user)).find((x) => x.id === Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Solar plant not found' });
    req.plant = p; next();
  }
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

  r.get('/solar', auth, async (req, res) => {
    const list = await myPlants(req.user);
    res.json(await Promise.all(list.map(async (p) => ({
      id: p.id, device_id: p.device_id, name: p.name, location: p.location, capacity_kwp: p.capacity_kwp,
      inverter_kw: p.inverter_kw, panel_count: p.panel_count, rated_kw: p.inverter_kw || p.capacity_kwp, limits: p.limits, ...(await solarLiveStatus(p)),
    }))));
  });

  r.get('/solar/:id/live', auth, guard, async (req, res) => {
    const p = req.plant;
    const [last, today, total, month, day, st] = await Promise.all([
      q('SELECT * FROM solar_telemetry WHERE plant_id=$1 ORDER BY ts DESC LIMIT 1', [p.id]),
      q('SELECT * FROM solar_daily_summary WHERE plant_id=$1 AND day=(now() AT TIME ZONE $2::text)::date', [p.id, TZ]),
      q('SELECT COALESCE(sum(energy_kwh),0) AS e FROM solar_daily_summary WHERE plant_id=$1', [p.id]),
      q(`SELECT COALESCE(sum(energy_kwh),0) AS e FROM solar_daily_summary WHERE plant_id=$1 AND day>=date_trunc('month', now() AT TIME ZONE $2::text)::date`, [p.id, TZ]),
      q('SELECT (now() AT TIME ZONE $1::text)::date AS d', [TZ]),
      solarLiveStatus(p)]);
    res.json({ last: last.rows[0] || null, today: today.rows[0] || null, total_energy_kwh: total.rows[0].e, month_energy_kwh: month.rows[0].e,
      today_date: day.rows[0].d, online: st.online, asleep: st.asleep, alerts: st.alerts });
  });

  r.get('/solar/:id/history', auth, guard, async (req, res) => {
    const [a, b] = await bounds(req);
    const bk = bucketOf(req.query.bucket), LIMIT = 20000;
    const { rows } = bk === 'raw'
      ? await q(`SELECT ts AS t, power_kw, dc_power_kw, dc_voltage_v, dc_current_a, ac_voltage_v, ac_current_a, frequency_hz, irradiance_wm2, panel_temp_c, ambient_temp_c, inverter_temp_c, efficiency_pct, energy_kwh
                 FROM solar_telemetry WHERE plant_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts DESC LIMIT ${LIMIT}`, [req.plant.id, a, b])
      : await q(`SELECT date_bin(($4 || ' seconds')::interval, ts, '2000-01-01'::timestamptz) AS t, ${AGG}
                 FROM solar_telemetry WHERE plant_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1 ORDER BY 1 DESC LIMIT ${LIMIT}`, [req.plant.id, a, b, String(bk)]);
    rows.reverse();
    res.json({ bucket: bk, truncated: rows.length >= LIMIT, rows });
  });
  r.get('/solar/:id/daily', auth, guard, async (req, res) => {
    const { from, to } = req.query;
    const { rows } = await q('SELECT * FROM solar_daily_summary WHERE plant_id=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day', [req.plant.id, from, to]);
    res.json({ rows });
  });
  r.get('/solar/:id/alerts', auth, guard, async (req, res) => {
    const [a, b] = await bounds(req);
    const { rows } = await q('SELECT id,ts,code,severity,part,message,value,active,cleared_at FROM solar_alerts WHERE plant_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts DESC LIMIT 1000', [req.plant.id, a, b]);
    res.json({ rows });
  });

  r.get('/solar/:id/export', auth, guard, async (req, res) => {
    const type = req.query.type || 'telemetry';
    const id = req.plant.id;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.plant.device_id}_${type}_${req.query.from || 'recent'}_${req.query.to || ''}.csv"`);
    if (type === 'daily') {
      const cols = ['day', 'energy_kwh', 'specific_yield_kwh_per_kwp', 'insolation_kwh_m2', 'performance_ratio_pct', 'avg_power_kw', 'peak_power_kw', 'avg_irradiance_wm2', 'peak_irradiance_wm2',
        'avg_panel_temp_c', 'max_panel_temp_c', 'generating_hours', 'capacity_factor_pct', 'samples'];
      res.write(cols.join(',') + '\n');
      const { rows } = await q(`SELECT day, energy_kwh, energy_kwh/NULLIF($4::float8,0) AS specific_yield_kwh_per_kwp, irr_wh/1000 AS insolation_kwh_m2,
        CASE WHEN irr_wh>0 THEN energy_kwh/($4::float8*irr_wh/1000)*100 END AS performance_ratio_pct,
        CASE WHEN samples>0 THEN sum_power/samples END AS avg_power_kw, max_power AS peak_power_kw,
        CASE WHEN irr_n>0 THEN sum_irr/irr_n END AS avg_irradiance_wm2, max_irr AS peak_irradiance_wm2,
        CASE WHEN ptemp_n>0 THEN sum_ptemp/ptemp_n END AS avg_panel_temp_c, max_ptemp AS max_panel_temp_c,
        run_seconds/3600 AS generating_hours, energy_kwh/($4::float8*24)*100 AS capacity_factor_pct, samples
        FROM solar_daily_summary WHERE plant_id=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day`,
      [id, req.query.from, req.query.to, req.plant.capacity_kwp]);
      rows.forEach((x) => res.write(line(cols, x)));
      return res.end();
    }
    const [a, b] = await bounds(req);
    if (type === 'alerts') {
      const cols = ['ts', 'severity', 'code', 'part', 'message', 'value', 'active', 'cleared_at'];
      res.write(cols.join(',') + '\n');
      const { rows } = await q('SELECT * FROM solar_alerts WHERE plant_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts', [id, a, b]);
      rows.forEach((x) => res.write(line(cols, x)));
      return res.end();
    }
    const bk = bucketOf(req.query.bucket);
    if (bk !== 'raw') {
      const cols = ['ts_local', 'ts_utc', 'power_kw', 'power_max', 'irradiance_wm2', 'panel_temp_c', 'ambient_temp_c', 'inverter_temp_c', 'dc_voltage_v', 'dc_current_a', 'ac_voltage_v', 'ac_current_a', 'frequency_hz', 'efficiency_pct', 'energy_kwh'];
      res.write(cols.join(',') + '\n');
      const { rows } = await q(`SELECT to_char(t AT TIME ZONE $5::text,'YYYY-MM-DD HH24:MI:SS') AS ts_local, t AS ts_utc, * FROM (
        SELECT date_bin(($4 || ' seconds')::interval, ts, '2000-01-01'::timestamptz) AS t, ${AGG} FROM solar_telemetry WHERE plant_id=$1 AND ts>=$2 AND ts<$3 GROUP BY 1) x ORDER BY t`, [id, a, b, String(bk), TZ]);
      rows.forEach((x) => res.write(line(cols, x)));
      return res.end();
    }
    const cols = ['ts_local', 'ts_utc', 'power_kw', 'dc_power_kw', 'dc_voltage_v', 'dc_current_a', 'ac_voltage_v', 'ac_current_a', 'frequency_hz', 'power_factor', 'irradiance_wm2', 'panel_temp_c', 'ambient_temp_c', 'inverter_temp_c', 'efficiency_pct', 'status', 'energy_kwh', 'extra'];
    res.write(cols.join(',') + '\n');
    let last = 0;
    for (;;) {
      const { rows } = await q(`SELECT id, to_char(ts AT TIME ZONE $5::text,'YYYY-MM-DD HH24:MI:SS') AS ts_local, ts AS ts_utc, power_kw, dc_power_kw, dc_voltage_v, dc_current_a, ac_voltage_v, ac_current_a, frequency_hz, power_factor, irradiance_wm2, panel_temp_c, ambient_temp_c, inverter_temp_c, efficiency_pct, status, energy_kwh, extra::text AS extra
        FROM solar_telemetry WHERE plant_id=$1 AND ts>=$2 AND ts<$3 AND id>$4 ORDER BY id LIMIT 10000`, [id, a, b, last, TZ]);
      if (!rows.length) break;
      res.write(rows.map((x) => line(cols, x)).join(''));
      last = rows[rows.length - 1].id;
    }
    res.end();
  });

  return { router: r, myPlants };
}
