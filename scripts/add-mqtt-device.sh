#!/usr/bin/env bash
# Usage: scripts/add-mqtt-device.sh <device_id> <password>
# Creates the MQTT login a turbine gateway uses. Username = device_id (same id you used in add-turbine).
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -eq 2 ] || { echo "Usage: $0 <device_id> <password>"; exit 1; }
docker compose exec -u root mosquitto mosquitto_passwd -b /mosquitto/config/passwd "$1" "$2"
docker compose kill -s SIGHUP mosquitto
echo "MQTT login created: user=$1  topic=zeekwind/turbines/$1/telemetry"
