import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, q, migrate } from './db.js';
import { LIMIT_KEYS } from './alerts.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2), nx = rest[i + 1]; if (nx === undefined || nx.startsWith('--')) flags[k] = true; else { flags[k] = nx; i++; } }
  else pos.push(rest[i]);
}
const help = `ZeekWind admin CLI   (run: docker compose exec app node src/cli.js <command>)

  add-user <username> <password> [--name "Full Name"] [--admin]
  reset-password <username> <new-password>
  add-turbine <device_id> "<Turbine name>" [--location "Site"] [--rated-kw 65]
  assign <username> <device_id>            give a user access to a turbine (a user can have many)
  unassign <username> <device_id>
  set-limit <device_id> <key> <number|null>   keys: ${LIMIT_KEYS.join(', ')}
  list                                      users, turbines, assignments, row counts
  purge <device_id> --before YYYY-MM-DD --yes [--keep-daily]   delete old data manually
  delete-turbine <device_id> --yes          delete a turbine and ALL its data`;
const need = (c, m) => { if (!c) { console.error(m || help); process.exit(1); } };
const user = async (u) => (await q('SELECT * FROM users WHERE username=$1', [u.toLowerCase()])).rows[0];
const turb = async (d) => (await q('SELECT * FROM turbines WHERE device_id=$1', [d])).rows[0];

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
  } else if (cmd === 'list') {
    console.table((await q('SELECT username, full_name, role FROM users ORDER BY id')).rows);
    console.table((await q(`SELECT t.device_id, t.name, t.rated_kw, t.limits::text AS limits, (SELECT count(*) FROM telemetry x WHERE x.turbine_id=t.id) AS samples,
      (SELECT string_agg(u.username, ', ') FROM user_turbines ut JOIN users u ON u.id=ut.user_id WHERE ut.turbine_id=t.id) AS users FROM turbines t ORDER BY t.id`)).rows);
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
