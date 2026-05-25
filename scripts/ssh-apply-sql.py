#!/usr/bin/env python3
"""Apply a local .sql file to the OP Central Supabase DB container via SSH.

Only touches the hws00sks44g8k04k8wccooco DB container. Pipes the file through
base64 to avoid quoting issues, runs it with psql -v ON_ERROR_STOP=1.

Usage:
    set SSH_PASSWORD=...   (PowerShell: $env:SSH_PASSWORD='...')
    python scripts/ssh-apply-sql.py [path/to/file.sql]
"""
import base64
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
SQL_PATH = sys.argv[1] if len(sys.argv) > 1 else "supabase/migrations/002_op_central_full.sql"

if not PASSWORD:
    print("Set SSH_PASSWORD env var (do not commit passwords).", file=sys.stderr)
    sys.exit(1)

with open(SQL_PATH, "rb") as f:
    b64 = base64.b64encode(f.read()).decode("ascii")

sp = PASSWORD.replace("'", "'\"'\"'")
remote = f"""#!/bin/bash
set -e
SID='{SID}'
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
DB=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-db-$SID" | head -1)
if [ -z "$DB" ]; then echo "DB container not found for $SID"; exit 1; fi
echo "DB container: $DB"
cat > /tmp/opc_apply.b64 <<'B64EOF'
{b64}
B64EOF
base64 -d /tmp/opc_apply.b64 > /tmp/opc_apply.sql
echo "SQL bytes: $(wc -c < /tmp/opc_apply.sql)"
SUDO docker cp /tmp/opc_apply.sql "$DB":/tmp/opc_apply.sql
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/opc_apply.sql
echo '--- tables in public ---'
SUDO docker exec "$DB" psql -U postgres -d postgres -c "select tablename from pg_tables where schemaname='public' order by 1;"
echo '--- row counts ---'
SUDO docker exec "$DB" psql -U postgres -d postgres -c "select 'config' t, count(*) from public.config union all select 'users', count(*) from public.users union all select 'categories', count(*) from public.categories union all select 'products', count(*) from public.products union all select 'boms', count(*) from public.boms union all select 'customers', count(*) from public.customers union all select 'vendors', count(*) from public.vendors union all select 'sales_orders', count(*) from public.sales_orders order by 1;"
rm -f /tmp/opc_apply.b64 /tmp/opc_apply.sql
SUDO docker exec "$DB" rm -f /tmp/opc_apply.sql
echo 'DONE'
"""


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    stdin, stdout, stderr = client.exec_command("bash -s", get_pty=False, timeout=240)
    stdin.write(remote)
    stdin.channel.shutdown_write()
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:\n" + err, file=sys.stderr)
    client.close()


if __name__ == "__main__":
    main()
