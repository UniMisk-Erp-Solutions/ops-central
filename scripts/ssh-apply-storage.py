#!/usr/bin/env python3
"""Apply migration 016 (site-update storage bucket + policies) to the SO-PO
Supabase DB container only. Idempotent & additive — creates the 'site-updates'
bucket and its storage.objects RLS policies. Nothing else is touched.

Run:  SSH_PASSWORD='...' python scripts/ssh-apply-storage.py
"""
import base64, os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

FILE = "supabase/migrations/016_site_update_storage.sql"
with open(FILE, "rb") as f:
    b64 = base64.b64encode(f.read()).decode("ascii")

sp = PW.replace("'", "'\"'\"'")
script = f"""#!/bin/bash
set -e
SID='{SID}'
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
DB=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-db-$SID" | head -1)
if [ -z "$DB" ]; then echo "DB container not found for $SID"; exit 1; fi
echo "Target DB container: $DB"
cat > /tmp/mig016.b64 <<'B64EOF'
{b64}
B64EOF
base64 -d /tmp/mig016.b64 > /tmp/mig016.sql
SUDO docker cp /tmp/mig016.sql "$DB":/tmp/mig016.sql >/dev/null
echo "===== applying 016_site_update_storage.sql ====="
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/mig016.sql
echo "----- 016 OK -----"
echo "===== buckets now ====="
SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select id, public from storage.buckets order by id"
echo "===== site-updates policies ====="
SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'site_updates%' order by policyname"
"""

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
stdin, stdout, stderr = cli.exec_command("bash -s")
stdin.write(script); stdin.channel.shutdown_write()
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("--- stderr ---\n" + err)
cli.close()
