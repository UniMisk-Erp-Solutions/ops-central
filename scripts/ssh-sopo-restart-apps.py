#!/usr/bin/env python3
"""Break the SO-PO crash-loop storm — SO-PO app containers ONLY.

Strategy: STOP the stateless SO-PO app containers (so they stop restart-thrashing
and CPU frees), WAIT ~50s for load to fall, then START them in dependency order
with health waits, KONG last.

STRICT SCOPE:
  * Every docker call is filtered by the SO-PO service id ({SID}). No other stack
    (pesowise, taskflow, any other Supabase/Coolify service) can match.
  * The DATABASE (supabase-db) and OBJECT STORE (supabase-minio) are NEVER touched
    — they stay running the whole time. No data is at risk.

Run:  SSH_PASSWORD='...' python scripts/ssh-sopo-restart-apps.py
"""
import os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

# NEVER in these lists: supabase-db, supabase-minio (data stores — kept running).
# Stop order (reverse dependency): gateway/UI first, log pipeline last.
STOP_ORDER = ["supabase-kong", "supabase-studio", "supabase-edge-functions",
              "supabase-supavisor", "realtime-dev", "supabase-meta",
              "supabase-storage", "supabase-auth", "supabase-rest",
              "imgproxy", "supabase-analytics", "supabase-vector"]
# Start order (forward dependency): log pipeline first, gateway last.
START_ORDER = ["supabase-vector", "supabase-analytics", "supabase-rest",
               "supabase-auth", "supabase-storage", "supabase-meta",
               "realtime-dev", "supabase-supavisor", "supabase-edge-functions",
               "imgproxy", "supabase-studio", "supabase-kong"]

sp = PW.replace("'", "'\"'\"'")
def blk(services, order_note):
    return "\n".join(services)

script = f"""#!/bin/bash
SID='{SID}'
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
name(){{ SUDO docker ps -a --filter "name=$1-$SID" --format '{{{{.Names}}}}' | head -1; }}

echo "=== BEFORE: load ==="; cut -d' ' -f1-3 /proc/loadavg
echo "=== SAFETY: db + minio must stay UP (never touched) ==="
for keep in supabase-db supabase-minio; do
  n=$(name "$keep"); echo "  KEEP $keep -> ${{n:-<not found>}} : $(SUDO docker inspect -f '{{{{.State.Status}}}}' "$n" 2>/dev/null)"
done

echo
echo "===== STOP app containers (db/minio left running) ====="
for s in {' '.join(STOP_ORDER)}; do
  n=$(name "$s"); [ -z "$n" ] && {{ echo "  (skip $s - absent)"; continue; }}
  SUDO docker stop -t 10 "$n" >/dev/null 2>&1 && echo "  stopped $n" || echo "  (could not stop $n)"
done

echo
echo "===== SETTLE: waiting 50s for CPU to drain ====="
for i in 1 2 3 4 5; do sleep 10; echo "  +$((i*10))s load: $(cut -d' ' -f1 /proc/loadavg)"; done

echo
echo "===== START in dependency order (kong last) ====="
wait_ok(){{
  local n; n=$(name "$1"); [ -z "$n" ] && return
  for i in $(seq 1 "$2"); do
    local h; h=$(SUDO docker inspect -f '{{{{if .State.Health}}}}{{{{.State.Health.Status}}}}{{{{else}}}}{{{{.State.Status}}}}{{{{end}}}}' "$n" 2>/dev/null)
    [ "$h" = "healthy" ] && {{ echo "    $1 healthy"; return; }}
    [ "$h" = "running" ] && [ "$i" -ge 2 ] && {{ echo "    $1 running"; return; }}
    sleep 3
  done
  echo "    $1 not-yet-healthy (continuing)"
}}
for s in {' '.join(START_ORDER)}; do
  n=$(name "$s"); [ -z "$n" ] && {{ echo "  (skip $s - absent)"; continue; }}
  SUDO docker start "$n" >/dev/null 2>&1 && echo "  started $n" || echo "  FAILED start $n"
  case "$s" in supabase-analytics|supabase-kong) wait_ok "$s" 25;; esac
done

echo
echo "===== FINAL status (SO-PO only) ====="
SUDO docker ps -a --filter "name=$SID" --format 'table {{{{.Names}}}}\t{{{{.Status}}}}' | sed 's/{SID}/SID/g'
echo "=== AFTER: load ==="; cut -d' ' -f1-3 /proc/loadavg
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
with open("scripts/_sopo_restart.out.txt", "w", encoding="utf-8") as f:
    f.write(out)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
