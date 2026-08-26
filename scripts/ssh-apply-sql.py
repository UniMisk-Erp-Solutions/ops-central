#!/usr/bin/env python3
"""Apply one or more SQL files to the SO-PO Supabase DB ONLY.

Each file runs with ON_ERROR_STOP=1 inside a single transaction, so a file
either fully applies or fully rolls back. Strictly scoped to the SO-PO service
id — no other stack on the host is touched.

Usage:
  SSH_PASSWORD='...' python scripts/ssh-apply-sql.py supabase/migrations/020_x.sql [more.sql ...]
"""
import base64, os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)
files = sys.argv[1:]
if not files:
    print("Pass at least one .sql file", file=sys.stderr); sys.exit(2)

sp = PW.replace("'", "'\"'\"'")
parts = ["""#!/bin/bash
set -e
SID='%s'
SUDO(){ echo '%s' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-$SID" | head -1)
if [ -z "$DB" ]; then echo "SO-PO DB container not found"; exit 1; fi
echo "Target DB: $DB"
""" % (SID, sp)]

for path in files:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    parts.append("""echo "===== applying %s ====="
cat > /tmp/apply.b64 <<'B64EOF'
%s
B64EOF
base64 -d /tmp/apply.b64 > /tmp/apply.sql
SUDO docker cp /tmp/apply.sql "$DB":/tmp/apply.sql >/dev/null
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f /tmp/apply.sql
echo "----- %s OK -----"
""" % (os.path.basename(path), b64, os.path.basename(path)))

parts.append('echo DONE\n')

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
stdin, stdout, stderr = cli.exec_command("bash -s", timeout=300)
stdin.write("".join(parts)); stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
cli.close()
if err.strip():
    out += "\n--- stderr ---\n" + err
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
