#!/usr/bin/env python3
"""Apply migrations 001..006 IN ORDER to the SO-PO Supabase DB container only.

Safe: targets exactly supabase-db-$SID (SID defaults to the SO-PO stack).
Each file runs with psql -v ON_ERROR_STOP=1; stops at the first failure.
The SO-PO public schema is empty, so this is purely additive. Prints a final
table list + row counts. Writes nothing outside the target DB.
"""
import base64, os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

FILES = [
    "supabase/migrations/001_op_central.sql",
    "supabase/migrations/002_op_central_full.sql",
    "supabase/migrations/003_auth_users.sql",
    "supabase/migrations/004_admin_signup.sql",
    "supabase/migrations/005_real_auth_rls.sql",
    "supabase/migrations/006_so_hold.sql",
]

# Build per-file base64 blocks
blocks = []
for path in FILES:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    name = os.path.basename(path)
    blocks.append((name, b64))

sp = PW.replace("'", "'\"'\"'")
parts = [f"""#!/bin/bash
set -e
SID='{SID}'
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
DB=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-db-$SID" | head -1)
if [ -z "$DB" ]; then echo "DB container not found for $SID"; exit 1; fi
echo "Target DB container: $DB"
echo "Pre-apply public tables: $(SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select count(*) from information_schema.tables where table_schema='public'")"
echo
"""]

for name, b64 in blocks:
    parts.append(f"""echo "===== applying {name} ====="
cat > /tmp/mig.b64 <<'B64EOF'
{b64}
B64EOF
base64 -d /tmp/mig.b64 > /tmp/mig.sql
SUDO docker cp /tmp/mig.sql "$DB":/tmp/mig.sql >/dev/null
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/mig.sql
echo "----- {name} OK -----"
echo
""")

parts.append("""echo "===== FINAL: tables in public ====="
SUDO docker exec "$DB" psql -U postgres -d postgres -c "select tablename from pg_tables where schemaname='public' order by 1;"
echo "===== FINAL: row counts ====="
SUDO docker exec "$DB" psql -U postgres -d postgres -c "select 'config' t,count(*) from public.config union all select 'users',count(*) from public.users union all select 'categories',count(*) from public.categories union all select 'products',count(*) from public.products union all select 'customers',count(*) from public.customers union all select 'vendors',count(*) from public.vendors union all select 'sales_orders',count(*) from public.sales_orders order by 1;" 2>&1 || echo "(row count summary skipped)"
SUDO docker exec "$DB" rm -f /tmp/mig.sql
rm -f /tmp/mig.b64 /tmp/mig.sql
echo DONE
""")

remote = "".join(parts)
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i, o, e = c.exec_command("bash -s", timeout=300); i.write(remote); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:\n" + err[:1500], file=sys.stderr)
c.close()
