#!/usr/bin/env python3
"""Full diagnose + attempt fix OPC Supabase on Ubuntu via SSH."""
import os
import re
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.16.112")
USER = os.environ.get("SSH_USER", "mithilmistry")
PW = os.environ.get("SSH_PASSWORD", "")
SID = "hws00sks44g8k04k8wccooco"
BASE = f"/data/coolify/services/{SID}"

if not PW:
    print("Set SSH_PASSWORD"); raise SystemExit(1)

sp = PW.replace("'", "'\"'\"'")

SCRIPT = f"""#!/bin/bash
set +e
SID="{SID}"
BASE="{BASE}"
SUDO() {{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}

echo "========== 1) CONNECTIVITY =========="
hostname -I | head -1

echo ""
echo "========== 2) OPC CONTAINERS =========="
SUDO docker ps -a --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}\\t{{{{.Ports}}}}' | grep -E "NAME|$SID" || echo "NO OPC CONTAINERS"

echo ""
echo "========== 3) OTHER SUPABASE (ports 54321/54323) =========="
SUDO docker ps --format '{{{{.Names}}}}\\t{{{{.Ports}}}}' | grep msc8 | head -5

echo ""
echo "========== 4) .env TEMPLATE ERRORS =========="
if SUDO test -f "$BASE/.env"; then
  grep -n '\\${{[^}}]*$' "$BASE/.env" && echo "^^ broken templates above" || echo "No unclosed \\${{ templates"
  echo "GOTRUE_SITE_URL=$(grep '^GOTRUE_SITE_URL=' "$BASE/.env" || echo MISSING)"
else
  echo ".env MISSING at $BASE/.env"
fi

echo ""
echo "========== 5) COMPOSE FILE =========="
COMPOSE=""
for f in "$BASE/docker-compose.yml" "$BASE/docker-compose.yaml" "$BASE/compose.yaml"; do
  if SUDO test -f "$f"; then COMPOSE="$f"; echo "Found: $f"; break; fi
done
if [ -z "$COMPOSE" ]; then
  echo "Searching compose..."
  SUDO find "$BASE" -maxdepth 2 -name '*compose*' -o -name '*.yml' 2>/dev/null | head -10
else
  echo "--- kong ports ---"
  SUDO grep -A6 'supabase-kong' "$COMPOSE" | head -15
  echo "--- studio ports ---"
  SUDO grep -A6 'supabase-studio' "$COMPOSE" | head -15
fi

echo ""
echo "========== 6) HTTP FROM SERVER =========="
curl -s -o /dev/null -w "54331 API: %{{http_code}}\\n" --connect-timeout 3 http://127.0.0.1:54331/rest/v1/ || echo "54331 unreachable"
curl -s -o /dev/null -w "54333 Studio: %{{http_code}}\\n" --connect-timeout 3 http://127.0.0.1:54333/ || echo "54333 unreachable"
curl -s -o /dev/null -w "54321 other: %{{http_code}}\\n" --connect-timeout 3 http://127.0.0.1:54321/rest/v1/ || true
curl -s -o /dev/null -w "54323 other: %{{http_code}}\\n" --connect-timeout 3 http://127.0.0.1:54323/ || true

echo ""
echo "========== 7) COOLIFY / DOCKER =========="
SUDO systemctl is-active docker || true
SUDO docker ps --format '{{{{.Names}}}}' | grep -i coolify | head -5

echo ""
echo "========== 8) RECENT OPC CONTAINER LOGS (if any) =========="
KONG=$(SUDO docker ps -a --format '{{{{.Names}}}}' | grep "supabase-kong-$SID" | head -1)
if [ -n "$KONG" ]; then
  echo "Kong: $KONG"
  SUDO docker logs "$KONG" --tail 8 2>&1
else
  STOPPED=$(SUDO docker ps -a --format '{{{{.Names}}}}' | grep "supabase-kong-$SID" | head -1)
  if [ -n "$STOPPED" ]; then
    SUDO docker logs "$STOPPED" --tail 15 2>&1
  else
    echo "No kong container exists — deploy never created containers"
  fi
fi

echo ""
echo "========== 9) COOLIFY DEPLOY LOG (if present) =========="
SUDO find /data/coolify -path "*{SID}*" -name "*.log" 2>/dev/null | head -5
SUDO ls -la "$BASE/" 2>/dev/null | head -15
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {USER}@{HOST}...")
    c.connect(HOST, username=USER, password=PW, timeout=20)
    stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
    stdin.write(SCRIPT)
    stdin.channel.shutdown_write()
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    print(out)
    if err.strip():
        print("STDERR:", err)
    c.close()
    print("=== DONE ===")

if __name__ == "__main__":
    main()
