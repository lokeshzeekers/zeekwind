import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, q, migrate } from './db.js';
import { LIMIT_KEYS } from './alerts.js';
import { SOLAR_LIMIT_KEYS } from './solar-alerts.js';
import { seedDemo, clearDemo } from './demo.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2), nx = rest[i + 1]; if (nx === undefined || nx.startsWith('--')) flags[k] = true; else { flags[k] = nx; i++; } }
  else pos.push(rest[i]);
}
const help = `Zeek Power admin CLI   (run: docker compose exec app node src/cli.js <command>)

  add-user <username> <password> [--name "Full Name"] [--admin]
  reset-password <username> <new-password>
  add-turbine <device_id> "<Turbine name>" [--location "Site"] [--rated-kw 65]
  assign <username> <device_id>            give a user access to a turbine (a user can have many)
  unassign <username> <device_id>
  set-limit <device_id> <key> <number|null>   keys: ${LIMIT_KEYS.join(', ')}
  list                                      users, turbines, assignments, row counts
  purge <device_id> --before YYYY-MM-DD --yes [--keep-daily]   delete old data manually
  delete-turbine <device_id> --yes          delete a turbine and ALL its data

SOLAR
  add-solar <device_id> "<Plant name>" [--location "Site"] [--capacity-kwp 26] [--inverter-kw 25] [--panels 60]
  assign-solar <username> <device_id>       give a user access to a solar plant (a user can have many)
  unassign-solar <username> <device_id>
  set-solar-limit <device_id> <key> <number|null>   keys: ${SOLAR_LIMIT_KEYS.join(', ')}
  purge-solar <device_id> --before YYYY-MM-DD --yes [--keep-daily]
  delete-solar <device_id> --yes            delete a solar plant and ALL its data

DEMO DATA (to see the dashboards without real hardware)
  seed-demo <device_id> [--days 14]         fill the last N days with realistic fake history (wind turbine or solar plant)
  clear-demo <device_id> --yes              remove only the fake history again`;
const need = (c, m) => { if (!c) { console.error(m || help); process.exit(1); } };
const user = async (u) => (await q('SELECT * FROM users WHERE username=$1', [u.toLowerCase()])).rows[0];
const turb = async (d) => (await q('SELECT * FROM turbines WHERE device_id=$1', [d])).rows[0];
const plant = async (d) => (await q('SELECT * FROM solar_plants WHERE device_id=$1', [d])).rows[0];
// a device id is also the MQTT username, so it must be unique across wind AND solar
const idFree = async (d) => !(await turb(d)) && !(await plant(d));

await migrate();
try {
  if (cmd === 'add-user') {
    need(pos[0] && pos[1]);
    need(pos[1].length >= 8, 'Password must be at least 8 characters');
    await q('INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$2,$3,$4)', [pos[0].toLowerCase(), flags.name || null, await bcrypt.hash(pos[1], 10), flags.admin ? 'admin' : 'user']);
    console.log(`User "${pos[0]}" created${flags.admin ? ' (admin: sees every turbine)' : ''}`);
  } else if (cmd === 'reset-password') {
    need(pos[0] && pos[1] && pos[1].length >= 8);
    const r = await q('UPDATE users SET password_hash=$2 WHERE username=$1', [pos[0].toLowerCase(), await bcrypt.hash(pos[1], 10)]);
    console.log(r.rowCount ? 'Password updated' : 'No such user');
  } else if (cmd === 'add-turbine') {
    need(pos[0] && pos[1]);
    need(/^[A-Za-z0-9_-]+$/.test(pos[0]), 'device_id may only contain letters, digits, - and _ (it is the MQTT username)');
    need(await idFree(pos[0]), `device_id "${pos[0]}" is already used by another turbine or solar plant`);
    await q('INSERT INTO turbines(device_id,name,location,rated_kw) VALUES($1,$2,$3,$4)', [pos[0], pos[1], flags.location || null, Number(flags['rated-kw']) || 65]);
    console.log(`Turbine "${pos[1]}" (${pos[0]}) created. Now create its MQTT login: scripts/add-mqtt-device.sh ${pos[0]} <password>`);
  } else if (cmd === 'assign' || cmd === 'unassign') {
    const u = await user(pos[0] || ''), t = await turb(pos[1] || '');
    need(u && t, 'User or turbine not found');
    if (cmd === 'assign') await q('INSERT INTO user_turbines VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, t.id]);
    else await q('DELETE FROM user_turbines WHERE user_id=$1 AND turbine_id=$2', [u.id, t.id]);
    console.log(`${cmd}ed ${u.username} <-> ${t.device_id}`);
  } else if (cmd === 'set-limit') {
    const t = await turb(pos[0] || '');
    need(t && LIMIT_KEYS.includes(pos[1]) && pos[2] !== undefined, `Valid keys: ${LIMIT_KEYS.join(', ')}`);
    const v = pos[2] === 'null' ? null : Number(pos[2]);
    need(v === null || Number.isFinite(v), 'Value must be a number or null');
    await q(v === null ? `UPDATE turbines SET limits = limits - $2 WHERE id=$1` : `UPDATE turbines SET limits = limits || jsonb_build_object($2::text, $3::float8) WHERE id=$1`, v === null ? [t.id, pos[1]] : [t.id, pos[1], v]);
    console.log((await turb(pos[0])).limits);
  } else if (cmd === 'add-solar') {
    need(pos[0] && pos[1], help);
    need(/^[A-Za-z0-9_-]+$/.test(pos[0]), 'device_id may only contain letters, digits, - and _ (it is the MQTT username)');
    need(await idFree(pos[0]), `device_id "${pos[0]}" is already used by another turbine or solar plant`);
    await q('INSERT INTO solar_plants(device_id,name,location,capacity_kwp,inverter_kw,panel_count) VALUES($1,$2,$3,$4,$5,$6)',
      [pos[0], pos[1], flags.location || null, Number(flags['capacity-kwp']) || 10, Number(flags['inverter-kw']) || null, Number(flags.panels) || null]);
    console.log(`Solar plant "${pos[1]}" (${pos[0]}) created. Now create its MQTT login: scripts/add-mqtt-device.sh ${pos[0]} <password>   (topic: zeekpower/solar/${pos[0]}/telemetry)`);
  } else if (cmd === 'assign-solar' || cmd === 'unassign-solar') {
    const u = await user(pos[0] || ''), p = await plant(pos[1] || '');
    need(u && p, 'User or solar plant not found (check the device id with: list)');
    if (cmd === 'assign-solar') await q('INSERT INTO user_solar_plants VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, p.id]);
    else await q('DELETE FROM user_solar_plants WHERE user_id=$1 AND plant_id=$2', [u.id, p.id]);
    console.log(`${cmd.replace('-solar', '')}ed ${u.username} <-> solar ${p.device_id}`);
  } else if (cmd === 'set-solar-limit') {
    const p = await plant(pos[0] || '');
    need(p && SOLAR_LIMIT_KEYS.includes(pos[1]) && pos[2] !== undefined, `Valid keys: ${SOLAR_LIMIT_KEYS.join(', ')}`);
    const v = pos[2] === 'null' ? null : Number(pos[2]);
    need(v === null || Number.isFinite(v), 'Value must be a number or null');
    await q(v === null ? `UPDATE solar_plants SET limits = limits - $2 WHERE id=$1` : `UPDATE solar_plants SET limits = limits || jsonb_build_object($2::text, $3::float8) WHERE id=$1`, v === null ? [p.id, pos[1]] : [p.id, pos[1], v]);
    console.log((await plant(pos[0])).limits);
  } else if (cmd === 'purge-solar') {
    const p = await plant(pos[0] || '');
    need(p && /^\d{4}-\d{2}-\d{2}$/.test(flags.before || ''), 'Usage: purge-solar <device_id> --before YYYY-MM-DD --yes');
    need(flags.yes, 'Add --yes to confirm. This cannot be undone.');
    const cut = (await q(`SELECT ($1::date)::timestamp AT TIME ZONE $2::text AS c`, [flags.before, process.env.APP_TIMEZONE || 'UTC'])).rows[0].c;
    const a = await q('DELETE FROM solar_telemetry WHERE plant_id=$1 AND ts<$2', [p.id, cut]);
    const b = await q('DELETE FROM solar_alerts WHERE plant_id=$1 AND ts<$2 AND NOT active', [p.id, cut]);
    let c = { rowCount: 0 };
    if (!flags['keep-daily']) c = await q('DELETE FROM solar_daily_summary WHERE plant_id=$1 AND day<$2::date', [p.id, flags.before]);
    console.log(`Deleted ${a.rowCount} samples, ${b.rowCount} alerts, ${c.rowCount} daily rows before ${flags.before}`);
  } else if (cmd === 'delete-solar') {
    const p = await plant(pos[0] || ''); need(p && flags.yes, 'Usage: delete-solar <device_id> --yes');
    await q('DELETE FROM solar_plants WHERE id=$1', [p.id]); console.log('Deleted');
  } else if (cmd === 'seed-demo' || cmd === 'clear-demo') {
    need(pos[0], help);
    if (cmd === 'seed-demo') console.log(await seedDemo(pos[0], Math.min(Math.max(Number(flags.days) || 14, 1), 90)));
    else { need(flags.yes, 'Add --yes to confirm (removes only the demo rows).'); console.log(await clearDemo(pos[0])); }
  } else if (cmd === 'list') {
    console.log('\nUSERS (wind / solar = how many each user can see; admins see all)');
    console.table((await q(`SELECT u.username, u.full_name, u.role,
      CASE WHEN u.role='admin' THEN 'all' ELSE (SELECT count(*)::text FROM user_turbines x WHERE x.user_id=u.id) END AS wind,
      CASE WHEN u.role='admin' THEN 'all' ELSE (SELECT count(*)::text FROM user_solar_plants x WHERE x.user_id=u.id) END AS solar FROM users u ORDER BY u.id`)).rows);
    console.log('WIND TURBINES');
    console.table((await q(`SELECT t.device_id, t.name, t.rated_kw, t.limits::text AS limits, (SELECT count(*) FROM telemetry x WHERE x.turbine_id=t.id) AS samples,
      (SELECT string_agg(u.username, ', ') FROM user_turbines ut JOIN users u ON u.id=ut.user_id WHERE ut.turbine_id=t.id) AS users FROM turbines t ORDER BY t.id`)).rows);
    console.log('SOLAR PLANTS');
    console.table((await q(`SELECT p.device_id, p.name, p.capacity_kwp, p.inverter_kw, p.panel_count, p.limits::text AS limits, (SELECT count(*) FROM solar_telemetry x WHERE x.plant_id=p.id) AS samples,
      (SELECT string_agg(u.username, ', ') FROM user_solar_plants up JOIN users u ON u.id=up.user_id WHERE up.plant_id=p.id) AS users FROM solar_plants p ORDER BY p.id`)).rows);
  } else if (cmd === 'purge') {
    const t = await turb(pos[0] || '');
    need(t && /^\d{4}-\d{2}-\d{2}$/.test(flags.before || ''), 'Usage: purge <device_id> --before YYYY-MM-DD --yes');
    need(flags.yes, 'Add --yes to confirm. This cannot be undone.');
    const cut = (await q(`SELECT ($1::date)::timestamp AT TIME ZONE $2::text AS c`, [flags.before, process.env.APP_TIMEZONE || 'UTC'])).rows[0].c;
    const a = await q('DELETE FROM telemetry WHERE turbine_id=$1 AND ts<$2', [t.id, cut]);
    const b = await q('DELETE FROM alerts WHERE turbine_id=$1 AND ts<$2 AND NOT active', [t.id, cut]);
    let c = { rowCount: 0 };
    if (!flags['keep-daily']) c = await q('DELETE FROM daily_summary WHERE turbine_id=$1 AND day<$2::date', [t.id, flags.before]);
    console.log(`Deleted ${a.rowCount} samples, ${b.rowCount} alerts, ${c.rowCount} daily rows before ${flags.before}`);
  } else if (cmd === 'delete-turbine') {
    const t = await turb(pos[0] || ''); need(t && flags.yes, 'Usage: delete-turbine <device_id> --yes');
    await q('DELETE FROM turbines WHERE id=$1', [t.id]); console.log('Deleted');
  } else console.log(help);
} catch (e) { console.error('Error:', e.message); process.exitCode = 1; }
await pool.end();
