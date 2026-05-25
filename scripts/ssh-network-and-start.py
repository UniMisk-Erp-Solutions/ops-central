#!/usr/bin/env python3
import os, paramiko
PW = os.environ["SSH_PASSWORD"]
sp = PW.replace("'", "'\"'\"'")
SID = "hws00sks44g8k04k8wccooco"
BASE = f"/data/coolify/services/{SID}"

SCRIPT = f"""#!/bin/bash
set -e
SUDO() {{ echo '{sp}' | sudo -S "$@"; }}

echo "=== Ensure .env fix ==="
SUDO sed -i 's|^GOTRUE_SITE_URL=\\${{SERVICE_URL_SUPABASEKONG$|GOTRUE_SITE_URL=${{SERVICE_URL_SUPABASEKONG}}|' "{BASE}/.env"

echo "=== Networks in compose ==="
SUDO grep -A5 '^networks:' "{BASE}/docker-compose.yml" | head -15

echo "=== Create external network if missing ==="
if ! SUDO docker network inspect "{SID}" >/dev/null 2>&1; then
  SUDO docker network create "{SID}"
  echo "Created network {SID}"
else
  echo "Network {SID} exists"
fi

echo "=== Also check coolify network naming ==="
SUDO docker network ls | grep -E 'coolify|{SID}|msc8' | head -10

echo "=== docker compose up ==="
SUDO bash -c 'cd "{BASE}" && docker compose --env-file .env up -d 2>&1' | tail -30

sleep 20
echo "=== Containers ==="
SUDO docker ps --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}\\t{{{{.Ports}}}}' | grep -E "NAME|{SID}" || echo NONE

echo "=== HTTP ==="
curl -s -o /dev/null -w "54331: %{{http_code}}\\n" http://127.0.0.1:54331/rest/v1/ || true
curl -s -o /dev/null -w "54333: %{{http_code}}\\n" http://127.0.0.1:54333/ || true
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=PW, timeout=20)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=600)
stdin.write(SCRIPT)
stdin.channel.shutdown_write()
print(stdout.read().decode())
c.close()
