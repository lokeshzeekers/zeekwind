// Fake solar plant for testing: publishes a JSON sample to MQTT every few seconds.
// node tools/simulate-solar.js --url mqtt://localhost:1883 --device zp-solar-01 --user zp-solar-01 --pass SECRET
//        [--interval 4] [--capacity 26] [--inverter 25] [--hour 12 | --fast] [--event overtemp|fault|lowoutput|overvoltage]
//
//  By default the sun follows your real local clock, so at night it correctly reports 0 kW.
//  --hour 12   freeze the sun at midday (good for a quick look at any time of day)
//  --fast      sweep sunrise to sunset in about 4 minutes, then repeat
import mqtt from 'mqtt';
const a = {}; for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (process.argv.includes('--fast')) a.fast = '1';
const url = a.url || 'mqtt://localhost:1883', device = a.device, every = (Number(a.interval) || 4) * 1000;
if (!device) { console.error('Need --device <device_id> (and --user/--pass if the broker requires login)'); process.exit(1); }
const cap = Number(a.capacity) || 10, inv = Number(a.inverter) || cap;
const c = mqtt.connect(url, { username: a.user || device, password: a.pass });
const topic = `zeekpower/solar/${device}/telemetry`;
let n = 0, wob = 0.9;
c.on('connect', () => { console.log('connected, publishing to', topic); setInterval(tick, every); tick(); });
c.on('error', (e) => console.error(e.message));
function hourNow() {
  if (a.hour !== undefined) return Number(a.hour);
  if (a.fast) return 5.5 + ((n * every) / 1000 / 240 * 14) % 14; // 5:30 -> 19:30 in 240 s
  const d = new Date(); return d.getHours() + d.getMinutes() / 60;
}
function tick() {
  n++;
  const h = hourNow(), sun = h > 6 && h < 18.5 ? Math.sin((Math.PI * (h - 6)) / 12.5) : 0;
  wob = Math.max(0.5, Math.min(1, wob + (Math.random() - 0.5) * 0.08));          // passing clouds
  const irr = sun > 0 ? 1000 * Math.pow(sun, 1.15) * wob : 0;
  const amb = 24 + 9 * Math.max(0, Math.sin((Math.PI * (h - 8)) / 12)) + (Math.random() - 0.5) * 0.4;
  const pt = amb + irr * 0.028;
  const ac = Math.min(inv, Math.max(0, ((cap * irr) / 1000) * (0.84 - 0.0035 * (pt - 25)) * (0.97 + Math.random() * 0.03)));
  const dc = ac > 0 ? ac / 0.975 : 0, vdc = irr > 20 ? 560 - (pt - 25) * 1.1 + (Math.random() - 0.5) * 4 : 0;
  const d = { power_kw: +ac.toFixed(2), dc_power_kw: +dc.toFixed(2), dc_voltage_v: +vdc.toFixed(1), dc_current_a: vdc ? +((dc * 1000) / vdc).toFixed(1) : 0,
    ac_voltage_v: +(398 + (Math.random() - 0.5) * 5).toFixed(1), ac_current_a: +((ac * 1000) / (Math.sqrt(3) * 398 * 0.99)).toFixed(1), frequency_hz: +(50 + (Math.random() - 0.5) * 0.08).toFixed(2),
    power_factor: +(0.97 + (Math.random() - 0.5) * 0.02).toFixed(3), irradiance_wm2: +irr.toFixed(0), panel_temp_c: +pt.toFixed(1), ambient_temp_c: +amb.toFixed(1),
    inverter_temp_c: +(amb + 8 + (ac / inv) * 22).toFixed(1), status: ac > 0.05 ? 'running' : 'standby' };
  if (n > 5 && a.event === 'overtemp') { d.panel_temp_c = 78; d.inverter_temp_c = 92; }
  if (n > 5 && a.event === 'fault') d.status = 'fault';
  if (n > 5 && a.event === 'lowoutput') d.power_kw = +(d.power_kw * 0.35).toFixed(2);
  if (n > 5 && a.event === 'overvoltage') d.dc_voltage_v = 900;
  c.publish(topic, JSON.stringify(d), { qos: 1 });
  console.log(new Date().toLocaleTimeString(), `sun@${h.toFixed(1)}h`, JSON.stringify(d));
}
