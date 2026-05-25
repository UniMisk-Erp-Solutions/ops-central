#!/usr/bin/env bash
# Run ON the server (or: ssh user@192.168.12.116 'bash -s' < scripts/server/health-check.sh)
set -euo pipefail

SERVICE_ID="${SUPABASE_SERVICE_ID:-hws00sks44g8k04k8wccooco}"
HOST_IP="${HOST_IP:-192.168.16.112}"

echo "=== Supabase health (service: ${SERVICE_ID}) ==="
echo

echo "--- Docker containers (supabase) ---"
sudo docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "supabase|NAMES" || true
echo

KONG=$(sudo docker ps --format '{{.Names}}' | grep "supabase-kong-${SERVICE_ID}" | head -1 || true)
DB=$(sudo docker ps --format '{{.Names}}' | grep "supabase-db-${SERVICE_ID}" | head -1 || true)
EDGE=$(sudo docker ps --format '{{.Names}}' | grep "supabase-edge-functions-${SERVICE_ID}" | head -1 || true)

if [[ -z "${KONG}" ]]; then
  echo "WARN: kong container not found for supabase-kong-${SERVICE_ID}"
else
  echo "--- Keys (kong: ${KONG}) ---"
  sudo docker exec "${KONG}" printenv SUPABASE_ANON_KEY 2>/dev/null | sed 's/^/ANON: /' || echo "Could not read ANON key"
  echo "(service role key omitted — run printenv SUPABASE_SERVICE_ROLE_KEY manually if needed)"
fi
echo

echo "--- HTTP checks from server ---"
curl -s -o /dev/null -w "REST :54321 → %{http_code}\n" "http://127.0.0.1:54321/rest/v1/" || echo "REST failed"
curl -s -o /dev/null -w "Studio :54323 → %{http_code}\n" "http://127.0.0.1:54323/" || echo "Studio failed"
echo

if [[ -n "${DB}" ]]; then
  echo "--- Postgres (${DB}) ---"
  sudo docker exec "${DB}" psql -U postgres -d postgres -t -c "select count(*) as auth_users from auth.users;" 2>/dev/null || echo "auth.users query failed"
  sudo docker exec "${DB}" psql -U postgres -d postgres -c "\dt public.*" 2>/dev/null || echo "public tables list failed"
fi
echo

if [[ -n "${EDGE}" ]]; then
  echo "--- Edge function (local) ---"
  curl -s -o /dev/null -w "functions/v1/main → %{http_code}\n" "http://127.0.0.1:54321/functions/v1/main" || echo "edge curl failed"
fi

echo
echo "--- Coolify data path ---"
ls -la "/data/coolify/services/${SERVICE_ID}/volumes/functions/" 2>/dev/null || echo "Path not found — run: sudo find /data/coolify/services -name functions"
echo
echo "From working PC browser:"
echo "  Coolify:  http://${HOST_IP}:8000"
echo "  Studio:   http://${HOST_IP}:54323"
echo "  API:      http://${HOST_IP}:54321"
