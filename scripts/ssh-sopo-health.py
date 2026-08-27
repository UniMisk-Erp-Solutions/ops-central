#!/usr/bin/env python3
"""READ-ONLY health check for the SO-PO Supabase stack ONLY.

Strictly scoped to containers whose name contains the SO-PO service id
(SUPABASE_SERVICE_ID). Touches nothing, restarts nothing, changes nothing —
it only runs `docker ps` and reads logs of any non-healthy container so we can
see what went wrong after the env change/restart.

Run:  SSH_PASSWORD='...' python scripts/ssh-sopo-health.py
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
# NOTE: every docker call is filtered by "$SID" so only SO-PO containers are seen.
script = f"""#!/bin/bash
SID='{SID}'
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}

echo "===== SO-PO containers ($SID) ====="
SUDO docker ps -a --filter "name=$SID" --format 'table {{{{.Names}}}}\t{{{{.Status}}}}'
echo

# Logs for anything not plainly healthy/up.
NAMES=$(SUDO docker ps -a --filter "name=$SID" --format '{{{{.Names}}}}')
for c in $NAMES; do
  ST=$(SUDO docker inspect -f '{{{{.State.Status}}}}{{{{if .State.Health}}}}/{{{{.State.Health.Status}}}}{{{{end}}}}' "$c" 2>/dev/null)
  case "$ST" in
    running|running/healthy) : ;;   # fine, skip
    *)
      echo "===== $c  [$ST]  — last 40 log lines ====="
      SUDO docker logs --tail 40 "$c" 2>&1
      echo
      ;;
  esac
done
echo "===== done (read-only; nothing was changed) ====="
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
# Write UTF-8 to a file (Windows console is cp1252 and chokes on log glyphs).
with open("scripts/_sopo_health.out.txt", "w", encoding="utf-8") as f:
    f.write(out)
# Also echo an ASCII-safe copy so it's visible even in a cp1252 terminal.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
