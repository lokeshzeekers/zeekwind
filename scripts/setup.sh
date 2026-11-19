#!/usr/bin/env bash
# First-time setup: creates .env with random secrets and the MQTT user the server uses.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { echo ".env already exists - nothing to do."; exit 1; }
PG=$(openssl rand -hex 16); JWT=$(openssl rand -hex 32); MQ=$(openssl rand -hex 16)
sed -e "s/__PG__/$PG/" -e "s/__JWT__/$JWT/" -e "s/__MQ__/$MQ/" .env.example > .env
mkdir -p mosquitto/data
docker run --rm -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -c -b /mosquitto/config/passwd zeekserver "$MQ"
chmod 644 mosquitto/config/passwd mosquitto/config/acl
echo "Done. Edit APP_TIMEZONE in .env, then run:  docker compose up -d --build"
