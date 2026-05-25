#!/usr/bin/env python3
"""Diagnose .env and try docker compose up for OPC service only."""
import os
import paramiko

HOST = "192.168.16.112"
USER = "mithilmistry"
PW = os.environ["SSH_PASSWORD"]
SID = "hws00sks44g8k04k8wccooco"
BASE = f"/data/coolify/services/{SID}"
sp = PW.replace("'", "'\"'\"'")

SCRIPT = f"""#!/bin/bash
set -x
BASE="{BASE}"
SUDO() {{ echo '{sp}' | sudo -S "$@"; }}

echo "=== .env broken lines (unclosed \\${{ ) ==="
SUDO grep -nE '\\$\\{{[^}}]+$' "$BASE/.env" || echo "none"
echo "=== GOTRUE ==="
SUDO grep GOTRUE "$BASE/.env" || true
echo "=== Any line with SUPABASEKONG without closing brace ==="
SUDO grep -n SUPABASEKONG "$BASE/.env" | head -20

echo "=== docker compose config test ==="
cd "$BASE" || exit 1
SUDO docker compose --env-file .env config 2>&1 | tail -30
CFG=$?
echo "compose config exit: $CFG"

if [ "$CFG" -eq 0 ]; then
  echo "=== docker compose up -d (OPC only) ==="
  SUDO docker compose --env-file .env up -d 2>&1 | tail -40
  sleep 5
  SUDO docker ps --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}\\t{{{{.Ports}}}}' | grep -E "NAME|{SID}" || echo "still no containers"
  curl -s -o /dev/null -w "54331: %{{http_code}}\\n" http://127.0.0.1:54331/rest/v1/ || true
  curl -s -o /dev/null -w "54333: %{{http_code}}\\n" http://127.0.0.1:54333/ || true
else
  echo "=== FIX common .env issues ==="
  SUDO cp "$BASE/.env" "$BASE/.env.bak-fix"
  SUDO sed -i 's|^GOTRUE_SITE_URL=\\${{SERVICE_URL_SUPABASEKONG$|GOTRUE_SITE_URL=${{SERVICE_URL_SUPABASEKONG}}|' "$BASE/.env"
  SUDO sed -i 's|\\${{SERVICE_URL_SUPABASEKONG$|\\${{SERVICE_URL_SUPABASEKONG}}|g' "$BASE/.env"
  echo "retry config..."
  SUDO docker compose --env-file .env config 2>&1 | tail -20
fi
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
stdin.write(SCRIPT)
stdin.channel.shutdown_write()
print(stdout.read().decode(errors="replace"))
print(stderr.read().decode(errors="replace"))
c.close()
