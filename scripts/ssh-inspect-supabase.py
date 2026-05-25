#!/usr/bin/env python3
"""Inspect ONE Coolify Supabase service via SSH. Does not modify other services."""
import os
import sys

try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr)
    sys.exit(1)

HOST = os.environ.get("SSH_HOST", "192.168.16.112")
USER = os.environ.get("SSH_USER", "mithilmistry")
PASSWORD = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "hws00sks44g8k04k8wccooco")

if not PASSWORD:
    print("Set SSH_PASSWORD env var (do not commit passwords to git).", file=sys.stderr)
    sys.exit(1)

def build_script(sid: str, sudo_pw: str) -> str:
    # sudo -S for non-interactive; only touches containers matching sid
    sp = sudo_pw.replace("'", "'\"'\"'")
    return f"""#!/bin/bash
set -e
SID='{sid}'
SUDO(){{
  echo '{sp}' | sudo -S "$@"
}}
echo '=== LAN IP ==='
hostname -I
echo
echo "=== Target containers ONLY ($SID) ==="
SUDO docker ps -a --format 'table {{{{.Names}}}}\t{{{{.Status}}}}\t{{{{.Ports}}}}' | grep "$SID" || echo "NONE FOUND for $SID"
echo
echo '=== Other supabase (names only) ==='
SUDO docker ps -a --format '{{{{.Names}}}}' | grep supabase | grep -v "$SID" || true
echo
echo '=== Coolify path ==='
SUDO ls -la "/data/coolify/services/$SID/" 2>/dev/null | head -8 || echo "MISSING path"
SUDO ls -la "/data/coolify/services/$SID/volumes/functions/" 2>/dev/null || echo "No functions dir"
echo
KONG=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-kong-$SID" | head -1 || true)
echo "=== Kong: $KONG ==="
if [ -n "$KONG" ]; then
  echo -n 'ANON_KEY='
  SUDO docker exec "$KONG" printenv SUPABASE_ANON_KEY || true
else
  echo 'KONG not running'
fi
echo
echo '=== HTTP (OP Central ports 54331 / 54333) ==='
curl -s -o /dev/null -w 'OPC API :54331 -> %{{http_code}}\n' http://127.0.0.1:54331/rest/v1/ || true
curl -s -o /dev/null -w 'OPC Studio :54333 -> %{{http_code}}\n' http://127.0.0.1:54333/ || true
echo '=== HTTP (other project — do not change) ==='
curl -s -o /dev/null -w 'other API :54321 -> %{{http_code}}\n' http://127.0.0.1:54321/rest/v1/ || true
curl -s -o /dev/null -w 'other Studio :54323 -> %{{http_code}}\n' http://127.0.0.1:54323/ || true
echo
DB=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-db-$SID" | head -1 || true)
echo "=== DB: $DB ==="
if [ -n "$DB" ]; then
  SUDO docker exec "$DB" psql -U postgres -d postgres -t -c 'select count(*) from auth.users;' 2>/dev/null || echo 'auth query failed'
  SUDO docker exec "$DB" psql -U postgres -d postgres -c '\\dt public.*' 2>/dev/null | head -15 || true
else
  echo 'DB not running'
fi
"""


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    script = build_script(SID, PASSWORD)
    stdin, stdout, stderr = client.exec_command("bash -s", get_pty=False, timeout=180)
    stdin.write(script)
    stdin.channel.shutdown_write()
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print(err, file=sys.stderr)
    client.close()


if __name__ == "__main__":
    main()
