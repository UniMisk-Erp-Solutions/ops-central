#!/usr/bin/env python3
"""Start the SO-PO Supabase stack back up — SO-PO ONLY.

Coolify stopped every container for a redeploy and left them exited (API 502).
The containers already exist with their config; this just `docker start`s them in
dependency order (db -> analytics -> everything else) and waits for health.

Strictly scoped: every docker call is filtered by the SO-PO service id. No other
project/stack is touched. Nothing is created, recreated, or deleted — only
`docker start` on already-existing SO-PO containers.

Run:  SSH_PASSWORD='...' python scripts/ssh-sopo-start.py
"""
import os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

sp = PW.replace("'", "'\"'\"'")
script = f"""#!/bin/bash
SID='{SID}'
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}

# Only ever act on containers whose name contains $SID.
has(){{ SUDO docker ps -a --filter "name=$1-$SID" --format '{{{{.Names}}}}' | head -1; }}
start_one(){{
  local n; n=$(has "$1")
  if [ -z "$n" ]; then echo "  (skip $1 - not present)"; return; fi
  local st; st=$(SUDO docker inspect -f '{{{{.State.Status}}}}' "$n" 2>/dev/null)
  if [ "$st" = "running" ]; then echo "  $n already running"; return; fi
  SUDO docker start "$n" >/dev/null 2>&1 && echo "  started $n" || echo "  FAILED to start $n"
}}
wait_healthy(){{
  local n; n=$(has "$1"); [ -z "$n" ] && return
  echo -n "  waiting for $1 "
  for i in $(seq 1 "$2"); do
    local h; h=$(SUDO docker inspect -f '{{{{if .State.Health}}}}{{{{.State.Health.Status}}}}{{{{else}}}}{{{{.State.Status}}}}{{{{end}}}}' "$n" 2>/dev/null)
    if [ "$h" = "healthy" ] || [ "$h" = "running" ]; then echo " -> $h"; return; fi
    echo -n "."; sleep 3
  done
  echo " -> still not healthy (continuing)"
}}

echo "===== 1) core: db + object store + imgproxy ====="
for s in supabase-db supabase-minio imgproxy; do start_one "$s"; done
wait_healthy supabase-db 30

echo "===== 2) analytics + vector (others depend on these) ====="
for s in supabase-vector supabase-analytics; do start_one "$s"; done
wait_healthy supabase-analytics 30

echo "===== 3) services ====="
for s in supabase-rest supabase-auth supabase-storage supabase-meta \\
         realtime-dev supabase-supavisor supabase-edge-functions supabase-studio; do start_one "$s"; done

echo "===== 4) gateway ====="
start_one supabase-kong
wait_healthy supabase-kong 30

echo
echo "===== final status (SO-PO only) ====="
SUDO docker ps -a --filter "name=$SID" --format 'table {{{{.Names}}}}\t{{{{.Status}}}}'
"""

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
stdin, stdout, stderr = cli.exec_command("bash -s")
stdin.write(script); stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
cli.close()
if err.strip():
    out += "\n--- stderr ---\n" + err
with open("scripts/_sopo_start.out.txt", "w", encoding="utf-8") as f:
    f.write(out)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
