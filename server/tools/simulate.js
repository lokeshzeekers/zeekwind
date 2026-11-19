// Fake turbine for testing: publishes a JSON sample to MQTT every few seconds.
// node tools/simulate.js --url mqtt://localhost:1883 --device zw-65kw-01 --user zw-65kw-01 --pass SECRET [--interval 4] [--event overspeed|vibration|fault|lowpower]
import mqtt from 'mqtt';
const a = {}; for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const url = a.url || 'mqtt://localhost:1883', device = a.device, every = (Number(a.interval) || 4) * 1000;
if (!device) { console.error('Need --device <device_id> (and --user/--pass if the broker requires login)'); process.exit(1); }
const c = mqtt.connect(url, { username: a.user || device, password: a.pass });
const topic = `zeekwind/turbines/${device}/telemetry`;
let wind = 7, dir = 230, yaw = 230, rpm = 0, n = 0;
// Illustrative test power curve only (NOT your turbine's real curve): cut-in 3, rated 11 m/s, cut-out 25.
const curve = (w) => (w < 3 || w > 25 ? 0 : w >= 11 ? 65 : 65 * ((w - 3) / 8) ** 3);
c.on('connect', () => { console.log('connected, publishing to', topic); setInterval(tick, every); tick(); });
c.on('error', (e) => console.error(e.message));
function tick() {
  n++;
  wind = Math.max(0, Math.min(28, wind + (Math.random() - 0.5) * 1.2 + Math.sin(n / 25) * 0.3));
  dir = (dir + (Math.random() - 0.5) * 6 + 360) % 360;
  yaw += ((dir - yaw + 540) % 360 - 180) * 0.2; yaw = (yaw + 360) % 360;
  let p = curve(wind) * (0.95 + Math.random() * 0.05);
  rpm += (Math.min(wind * 18, 200) * (p > 0 ? 1 : 0.1) - rpm) * 0.3;
  const d = { wind_speed: +wind.toFixed(2), wind_direction: +dir.toFixed(0), rotor_rpm: +rpm.toFixed(1), power_kw: +p.toFixed(2),
    voltage_v: +(400 + (Math.random() - 0.5) * 6).toFixed(1), current_a: +((p * 1000) / (Math.sqrt(3) * 400 * 0.95)).toFixed(1),
    frequency_hz: +(50 + (Math.random() - 0.5) * 0.1).toFixed(2), yaw_angle: +yaw.toFixed(0), vibration_mm_s: +(0.8 + Math.random() * 0.4).toFixed(2),
    generator_temp_c: +(45 + p * 0.5 + Math.random()).toFixed(1), brake: false, status: p > 0 ? 'running' : 'idle' };
  if (n > 5 && a.event === 'overspeed') d.rotor_rpm = 260;
  if (n > 5 && a.event === 'vibration') d.vibration_mm_s = 9.5;
  if (n > 5 && a.event === 'fault') d.status = 'fault';
  if (n > 5 && a.event === 'lowpower') { d.wind_speed = 13; d.power_kw = 12; }
  c.publish(topic, JSON.stringify(d), { qos: 1 });
  console.log(new Date().toLocaleTimeString(), JSON.stringify(d));
}
