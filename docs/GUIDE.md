# ZeekWind: setup and operations guide

ZeekWind is a live monitoring dashboard for wind turbines (built for your 65 kW turbine).
Each turbine sends a reading every 3-5 seconds over MQTT. The server stores every reading,
calculates energy and daily totals, raises alerts, and pushes the live values to the browser.

```
 Turbine controller ──(Modbus / analog / serial)──► Gateway at the turbine
                                                       │  MQTT, every 3-5 s
                                                       ▼
                       VPS:  Mosquitto (MQTT broker) ─► ZeekWind server ─► PostgreSQL (kept until you delete)
                                                              │  HTTPS + WebSocket
                                                              ▼
                                                  Browser (login per user)
```

Project layout

| Folder | What it is |
|---|---|
| `server/` | Node.js + Express API, MQTT receiver, alert engine, admin CLI, test simulator |
| `web/` | React dashboard (Vite) |
| `mosquitto/config/` | MQTT broker config and access rules |
| `gateway/modbus_to_mqtt.py` | Template for the small computer at the turbine |
| `scripts/` | `setup.sh`, `add-mqtt-device.sh` |

---

## 1. Deploy on your VPS

You need a Linux VPS (Ubuntu 22.04 or newer is fine, 1 GB RAM minimum) with Docker.

```bash
# install Docker (skip if you have it)
curl -fsSL https://get.docker.com | sudo sh

# copy the project to the VPS (from your computer), then on the VPS:
cd zeekwind
./scripts/setup.sh            # creates .env with random secrets + the server's MQTT login
nano .env                     # set APP_TIMEZONE to your site's timezone (e.g. Asia/Kolkata)
docker compose up -d --build  # first build takes a few minutes
docker compose logs -f app    # you should see: "ZeekWind server on :3000" and "[mqtt] connected"
```

The dashboard is now on the VPS at port 3000 (bound to localhost only, on purpose).

### HTTPS with your domain (recommended)

Point a DNS A record (for example `dashboard.yourcompany.com`) to the VPS, then use Caddy,
which gets and renews the certificate by itself:

```bash
sudo apt install -y caddy
sudo cp Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # replace dashboard.example.com with your domain
sudo systemctl reload caddy
```

Firewall: allow 22 (SSH), 80 and 443. Allow MQTT (1883, or 8883 for TLS) only for the turbine
gateway, ideally restricted to its IP: `sudo ufw allow from <gateway-ip> to any port 1883`.

---

## 2. Create users and turbines

All admin tasks use one command. Run it on the VPS inside the project folder:

```bash
alias zw='docker compose exec app node src/cli.js'
```

```bash
# 1. a turbine (device id = the turbine's MQTT username; letters, digits, - and _ only)
zw add-turbine zw-65kw-01 "Turbine 01" --location "North field" --rated-kw 65
./scripts/add-mqtt-device.sh zw-65kw-01 'a-strong-password-for-the-gateway'

# 2. users
zw add-user rajesh 'Rajesh#Pass2026' --name "Rajesh Kumar"        # a normal customer
zw add-user admin  'Admin#Pass2026'  --name "Site Admin" --admin  # admin sees every turbine

# 3. who sees what (one user can have several turbines)
zw assign rajesh zw-65kw-01
zw assign rajesh zw-65kw-02
zw unassign rajesh zw-65kw-02

zw list                                  # users, turbines, assignments, sample counts
zw reset-password rajesh 'NewPass#2026'
```

A customer logs in and sees only the turbines assigned to them. If they have more than one,
a turbine selector appears at the top. Passwords need at least 8 characters.

---

## 3. Data format the turbine must send

- Topic: `zeekwind/turbines/<device_id>/telemetry`
- Login: username = `<device_id>`, password = the one you set with `add-mqtt-device.sh`.
  A gateway can publish only to its own topic, so one turbine cannot write into another.
- One JSON object every 3-5 seconds. **Every field is optional**: send what your controller has.

| Field | Unit | Notes |
|---|---|---|
| `wind_speed` | m/s | turbine anemometer |
| `wind_direction` | degrees 0-360 | direction the wind comes **from** |
| `rotor_rpm` | rpm | |
| `power_kw` | kW | electrical output |
| `voltage_v` | V | |
| `current_a` | A | |
| `frequency_hz` | Hz | |
| `yaw_angle` | degrees 0-360 | where the nacelle points |
| `vibration_mm_s` | mm/s | optional sensor |
| `generator_temp_c` | °C | optional sensor, used for an alert only |
| `brake` | true / false | |
| `status` | text | `running`, `idle`, `stopped`, `fault` |

Any other field you add (for example `phase_a_voltage`) is stored in an `extra` column and
included in the readings CSV, so nothing is lost.

Time: the server stamps each reading with its own clock when it arrives.

Energy: each reading adds `power_kw × seconds since the previous reading ÷ 3600` kWh
(gaps longer than 15 s count as 15 s, so an outage never invents energy). Daily totals,
lifetime energy, run time and capacity factor are built from that.

---

## 4. Test from the terminal (no real turbine needed)

Install the MQTT client tools on any computer:

```bash
sudo apt install -y mosquitto-clients
```

**Send one reading by hand**

```bash
mosquitto_pub -h YOUR_VPS_IP_OR_DOMAIN -p 1883 -u zw-65kw-01 -P 'a-strong-password-for-the-gateway' \
  -t zeekwind/turbines/zw-65kw-01/telemetry \
  -m '{"wind_speed":8.4,"wind_direction":230,"rotor_rpm":120,"power_kw":28.5,"voltage_v":400,"current_a":42,"frequency_hz":50.0,"yaw_angle":228,"status":"running","brake":false}'
```

Open the dashboard: the numbers update immediately and the status shows Live.

**Send a continuous fake turbine** (a new reading every 4 s, with a wind and power model)

```bash
docker compose exec app node tools/simulate.js --url mqtt://mosquitto:1883 \
  --device zw-65kw-01 --pass 'a-strong-password-for-the-gateway' --interval 4
```

Add `--event overspeed`, `--event vibration`, `--event fault` or `--event lowpower` to trigger an
alert on the turbine picture. Overspeed and vibration only alert if you set those limits (section 6).
The simulator's power curve is only for testing; it is not your turbine's real curve.

**Watch what the broker receives**

```bash
mosquitto_sub -h YOUR_VPS_IP_OR_DOMAIN -u zeekserver -P "$(grep MQTT_SERVER_PASSWORD .env | cut -d= -f2)" -t 'zeekwind/turbines/+/telemetry' -v
```

**Test the offline alert**: stop sending. After 30 seconds (`OFFLINE_AFTER_SECONDS` in `.env`) the
dashboard shows Offline and raises a critical alert. It clears by itself when data returns.

---

## 5. Connect the real turbine

The dashboard needs a small "gateway" at the turbine that reads the controller and publishes
the JSON above. What you use depends on what your controller offers. Ask the turbine
manufacturer or installer these questions:

1. Does the controller or inverter have a digital data port? Typically Modbus RTU (RS-485) or
   Modbus TCP (Ethernet).
2. Can they send the **register map** (address, type, scale, unit) for: wind speed, rotor rpm,
   power, voltage, current, frequency, yaw angle, status/fault code?
3. If a value is not available digitally (often wind direction or vibration), is there an analog
   sensor output (4-20 mA or 0-10 V) that a gateway can read?

**Option A: Modbus (most common).** Use a Raspberry Pi, an industrial gateway, or any small
Linux computer on the same network or RS-485 line as the controller. Start from
`gateway/modbus_to_mqtt.py`: fill in the `REGISTERS` table from the manual, set the host,
device id and password, and run it. Test it by running it by hand first and watching the dashboard.

Run it permanently with systemd:

```ini
# /etc/systemd/system/zeekwind-gateway.service
[Unit]
Description=ZeekWind gateway
After=network-online.target
[Service]
ExecStart=/usr/bin/python3 /opt/zeekwind/modbus_to_mqtt.py
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now zeekwind-gateway
```

**Option B: controller already speaks MQTT.** Point it at the VPS broker with the device id as
username and the topic above. If it can only send a different JSON layout, tell me the layout and
I will add a mapping on the server.

**Option C: analog sensors and PLC.** A PLC or an ESP32/Arduino with an ADC can read the sensors and
publish the same JSON. Same topic, same login.

Checklist before you go live: the gateway's clock does not matter (the server stamps time),
the internet link must allow outbound TCP to the VPS on the MQTT port, and the gateway should
publish every 3-5 seconds with QoS 1.

### Encrypt the MQTT link (do this for a real site)

Port 1883 is plain text, including the password. Once you have a domain with a certificate
(for example from `certbot certonly --standalone -d mqtt.yourcompany.com`), add this to
`mosquitto/config/mosquitto.conf`, mount `/etc/letsencrypt` into the mosquitto container in
`docker-compose.yml`, publish port 8883, and restart:

```
listener 8883
cafile /etc/letsencrypt/live/mqtt.yourcompany.com/chain.pem
certfile /etc/letsencrypt/live/mqtt.yourcompany.com/cert.pem
keyfile /etc/letsencrypt/live/mqtt.yourcompany.com/privkey.pem
```

Then the gateway connects to port 8883 with TLS enabled. Close port 1883 in the firewall.

---

## 6. Alerts on the turbine picture

Alert rules run **only when you set a limit for that turbine**. Nothing is assumed about your
machine. Set the limits from your turbine's datasheet:

```bash
zw set-limit zw-65kw-01 max_rpm 200          # rotor over-speed (critical)
zw set-limit zw-65kw-01 cut_out 25           # wind above cut-out speed (warning)
zw set-limit zw-65kw-01 rated_wind 11        # enables "low output at rated wind" (warning)
zw set-limit zw-65kw-01 max_power_kw 72      # over-power (warning)
zw set-limit zw-65kw-01 max_gen_temp 90      # generator temperature (critical)
zw set-limit zw-65kw-01 max_vibration 5      # vibration (warning)
zw set-limit zw-65kw-01 voltage_min 360      # voltage band (warning)
zw set-limit zw-65kw-01 voltage_max 440
zw set-limit zw-65kw-01 freq_min 49          # frequency band (warning)
zw set-limit zw-65kw-01 freq_max 51
zw set-limit zw-65kw-01 max_rpm null         # remove a limit
```

(The numbers above are examples only, not recommendations for your turbine.)

Always active: a `fault` status from the controller (critical), and **no data for 30 s** (critical).

Where they show: the matching hotspot on the photo (rotor and blades, generator and nacelle,
tail vane and yaw, tower, electrical and comms) pulses amber (warning) or red (critical), a
label with the message appears next to it, and the alert is listed under Alerts. Every alert is
stored with its raised and cleared time (History and reports, Alert history).

---

## 7. History, downloads and deleting data

- **History and reports** tab: pick a date range, see energy, average wind, peak power, run
  time and capacity factor, charts, a day-by-day table and the alert history.
- **Download** buttons: readings (every sample, or 1/10/60 minute averages), daily summary, alerts.
  All are CSV and open in Excel. Readings include local time (your `APP_TIMEZONE`) and UTC.
- Data is kept **until you delete it**. Roughly 17,000-25,000 readings per turbine per day.

Delete old data manually (cannot be undone):

```bash
zw purge zw-65kw-01 --before 2026-01-01 --yes                 # readings, old alerts and daily totals
zw purge zw-65kw-01 --before 2026-01-01 --yes --keep-daily    # keep the daily summaries
zw delete-turbine zw-65kw-01 --yes                            # turbine and everything it recorded
```

---

## 8. Operations

```bash
docker compose ps                         # status
docker compose logs -f app                # server log
docker compose logs -f mosquitto          # broker log (login failures show here)
docker compose up -d --build              # apply code changes after you edit the project

# backup the database (do this on a schedule, e.g. daily with cron)
docker compose exec -T db pg_dump -U zeek zeekwind | gzip > zeekwind_$(date +%F).sql.gz

# restore
gunzip -c zeekwind_2026-11-19.sql.gz | docker compose exec -T db psql -U zeek zeekwind
```

Troubleshooting

| Problem | Check |
|---|---|
| Dashboard says "No data received yet" | `docker compose logs mosquitto` for "not authorised" or login failures; is the device id the same in `add-turbine`, the MQTT username and the topic? |
| Log says `[ingest] unknown device` | The device id in the topic is not a turbine in the database. Run `zw list`. |
| Log says `invalid JSON` | The gateway is sending something that is not a JSON object. |
| Shows Offline although the gateway runs | Gateway not reaching the VPS port, or readings are slower than 30 s. Raise `OFFLINE_AFTER_SECONDS`. |
| "Live connection lost" banner | The reverse proxy must pass WebSockets on `/ws`. Caddy does by default; with Nginx add the `Upgrade` headers. |
| Daily totals cut at the wrong time | Fix `APP_TIMEZONE` in `.env`, then `docker compose up -d`. Existing days keep the old cut. |

Local development without Docker: run PostgreSQL and Mosquitto yourself, copy the variables from
`.env.example` into `server/.env` (see `server/src/index.js` for names), then
`cd server && npm install && node src/index.js` and `cd web && npm install && npm run dev`.

---

## 9. What was not assumed

- **Which readings your controller can send.** Every field is optional.
- **Alert thresholds.** None are preset. You set them per turbine.
- **Timezone.** `APP_TIMEZONE` in `.env` ships as `Asia/Kolkata`; change it if the site is elsewhere.
- **Temperature and weather.** There are no weather or ambient-temperature panels. Generator
  temperature is only used for an alert if your turbine sends it.
- **Rated power** defaults to 65 kW, as you said. Cut-in, rated wind speed, rated rpm and other specs are not used until you set the limits above.
