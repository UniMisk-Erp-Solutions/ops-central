#!/usr/bin/env bash
# Run on Ubuntu when Coolify deploy fails for supabase-hws00sks44g8k04k8wccooco ONLY.
set -euo pipefail
SID="hws00sks44g8k04k8wccooco"
BASE="/data/coolify/services/${SID}"

echo "Fix .env GOTRUE line..."
sudo sed -i 's|^GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG$|GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG}|' "${BASE}/.env"
grep '^GOTRUE_SITE_URL=' "${BASE}/.env"

echo "Ensure Docker network..."
sudo docker network inspect "${SID}" >/dev/null 2>&1 || sudo docker network create "${SID}"

echo "Start stack..."
sudo bash -c "cd '${BASE}' && docker compose --env-file .env up -d"

echo "Autostart (OPC containers only)..."
for c in $(sudo docker ps -a --format '{{.Names}}' | grep "${SID}"); do
  sudo docker update --restart unless-stopped "$c"
done

echo "Health:"
curl -s -o /dev/null -w "  Studio :54333 -> %{http_code}\n" http://127.0.0.1:54333/
curl -s -o /dev/null -w "  API    :54331 -> %{http_code}\n" http://127.0.0.1:54331/rest/v1/
