#!/usr/bin/env python3
import os
import paramiko

PW = os.environ["SSH_PASSWORD"]
sp = PW.replace("'", "'\"'\"'")
SID = "hws00sks44g8k04k8wccooco"
BASE = f"/data/coolify/services/{SID}"

SCRIPT = f"""#!/bin/bash
set -e
SUDO() {{ echo '{sp}' | sudo -S "$@"; }}

echo "=== Fix .env (Coolify keeps breaking GOTRUE line) ==="
SUDO cp "{BASE}/.env" "{BASE}/.env.bak-$(date +%Y%m%d%H%M%S)"
SUDO sed -i 's|^GOTRUE_SITE_URL=\\${{SERVICE_URL_SUPABASEKONG$|GOTRUE_SITE_URL=${{SERVICE_URL_SUPABASEKONG}}|' "{BASE}/.env"
SUDO grep '^GOTRUE_SITE_URL=' "{BASE}/.env"

echo "=== Validate compose ==="
SUDO bash -c 'cd "{BASE}" && docker compose --env-file .env config >/dev/null'
echo "compose config OK"

echo "=== Pull + start (may take several minutes) ==="
SUDO bash -c 'cd "{BASE}" && docker compose --env-file .env pull 2>&1' | tail -15
SUDO bash -c 'cd "{BASE}" && docker compose --env-file .env up -d 2>&1' | tail -25

echo "=== Wait 15s for health ==="
sleep 15

echo "=== OPC containers ==="
SUDO docker ps -a --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}\\t{{{{.Ports}}}}' | grep -E "NAME|{SID}"

echo "=== HTTP ==="
curl -s -o /dev/null -w "54331 API: %{{http_code}}\\n" --connect-timeout 5 http://127.0.0.1:54331/rest/v1/ || echo fail
curl -s -o /dev/null -w "54333 Studio: %{{http_code}}\\n" --connect-timeout 5 http://127.0.0.1:54333/ || echo fail

echo "=== Autostart policy (OPC only) ==="
for c in $(SUDO docker ps -a --format '{{{{.Names}}}}' | grep "{SID}" || true); do
  SUDO docker update --restart unless-stopped "$c"
  echo "  $c"
done

echo "=== ANON KEY ==="
KONG=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-kong-{SID}" | head -1)
if [ -n "$KONG" ]; then
  SUDO docker exec "$KONG" printenv SUPABASE_ANON_KEY | head -c 60
  echo "..."
fi
echo DONE
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=PW, timeout=20)
print("Connected. Fixing .env and starting docker compose (this can take 5-10 min)...")
stdin, stdout, stderr = c.exec_command("bash -s", timeout=600)
stdin.write(SCRIPT)
stdin.channel.shutdown_write()
while True:
    line = stdout.readline()
    if not line:
        break
    print(line, end="")
err = stderr.read().decode()
if err:
    print("ERR:", err[-2000:])
c.close()
