#!/usr/bin/env bash
# Usage: scripts/add-mqtt-device.sh <device_id> <password>   (wind turbine OR solar plant)
# Creates the MQTT login a turbine or solar-plant gateway uses. Username = device_id (same id you used in add-turbine).
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -eq 2 ] || { echo "Usage: $0 <device_id> <password>"; exit 1; }
docker compose exec -u root mosquitto mosquitto_passwd -b /mosquitto/config/passwd "$1" "$2"
docker compose kill -s SIGHUP mosquitto
echo "MQTT login created: user=$1"
echo "  wind topic : zeekwind/turbines/$1/telemetry"
echo "  solar topic: zeekpower/solar/$1/telemetry"
