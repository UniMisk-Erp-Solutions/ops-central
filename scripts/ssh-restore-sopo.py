#!/usr/bin/env python3
"""Faithfully load the OLD cluster's data into the NEW SO-PO Supabase.

Strategy (safe + reversible):
  1. Upload the postgres-only slice of full_cluster.sql (no roles, no logs DB).
  2. Back up the current SO-PO postgres DB (custom-format) to the host.
  3. Load the slice into an ISOLATED temp DB (clone_src) — never alters roles
     or live system schemas.
  4. Transplant public (full schema+data) and auth DATA (users then identities)
     from clone_src into the live postgres DB.
  5. Reload PostgREST, verify row counts, drop clone_src.

Touches ONLY the SO-PO stack (SID below). Skips roles/passwords entirely.
"""
import os, sys, io
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
SRC = "full_cluster.sql"
START_LINE = 131913  # first line of the `postgres` DB dump (after \connect postgres)
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

# --- build the slice in memory ---
print("Reading + slicing", SRC, "...")
with open(SRC, "r", encoding="utf-8", errors="replace") as f:
    lines = f.readlines()
slice_lines = lines[START_LINE - 1:]
slice_text = "".join(slice_lines)
assert slice_lines[0].startswith("-- PostgreSQL database dump"), slice_lines[0][:80]
assert "\\connect" not in slice_text[:500], "unexpected \\connect near slice start"
print(f"slice: {len(slice_lines)} lines, {len(slice_text.encode('utf-8'))} bytes")

sp = PW.replace("'", "'\"'\"'")
remote = r"""#!/bin/bash
set -uo pipefail
SID='__SID__'
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-$SID" | head -1)
REST=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-rest-$SID" | head -1)
if [ -z "$DB" ]; then echo "FATAL: SO-PO db container not found"; exit 1; fi
echo "DB=$DB  REST=$REST"
PSQL(){ SUDO docker exec -i "$DB" psql -U postgres "$@"; }

echo "=== 0. pre-state (live public + auth users) ==="
PSQL -d postgres -tAc "select 'pub.tables='||count(*) from information_schema.tables where table_schema='public'"
PSQL -d postgres -tAc "select 'auth.users='||count(*) from auth.users"

echo "=== 1. BACKUP current postgres DB (custom format) ==="
SUDO docker exec "$DB" pg_dump -U postgres -Fc -d postgres -f /tmp/sopo_pre_restore.dump && echo "backup made in container"
SUDO docker cp "$DB":/tmp/sopo_pre_restore.dump /home/__USER__/sopo_pre_restore.dump && echo "backup copied to /home/__USER__/sopo_pre_restore.dump ($(ls -la /home/__USER__/sopo_pre_restore.dump | awk '{print $5}') bytes)"

echo "=== 2. (re)create isolated temp DB clone_src ==="
PSQL -d postgres -c "DROP DATABASE IF EXISTS clone_src;"
PSQL -d postgres -c "CREATE DATABASE clone_src;"

echo "=== 3. load slice into clone_src (errors non-fatal) ==="
SUDO docker cp /home/__USER__/pg_only.sql "$DB":/tmp/pg_only.sql
SUDO docker exec -i "$DB" psql -U postgres -d clone_src -v ON_ERROR_STOP=0 -f /tmp/pg_only.sql > /tmp/clone_load.log 2>&1
echo "clone load errors: $(grep -c '^ERROR' /tmp/clone_load.log)   (non-public/auth errors are OK)"
echo "clone public.users=$(PSQL -d clone_src -tAc 'select count(*) from public.users')  auth.users=$(PSQL -d clone_src -tAc 'select count(*) from auth.users')"

echo "=== 4a. replace live public from clone (drop + restore full schema+data) ==="
PSQL -d postgres -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; GRANT ALL ON SCHEMA public TO postgres;"
SUDO docker exec -i "$DB" sh -c "pg_dump -U postgres -d clone_src -n public | psql -U postgres -d postgres -v ON_ERROR_STOP=0" > /tmp/pub_restore.log 2>&1
echo "public restore errors: $(grep -c '^ERROR' /tmp/pub_restore.log)"
grep '^ERROR' /tmp/pub_restore.log | sort | uniq -c | head -10

echo "=== 4b. load auth DATA: users then identities (FK-safe order) ==="
SUDO docker exec -i "$DB" sh -c "pg_dump -U postgres -d clone_src --data-only -t auth.users | psql -U postgres -d postgres -v ON_ERROR_STOP=0" > /tmp/auth_u.log 2>&1
echo "auth.users load errors: $(grep -c '^ERROR' /tmp/auth_u.log)"; grep '^ERROR' /tmp/auth_u.log | head -5
SUDO docker exec -i "$DB" sh -c "pg_dump -U postgres -d clone_src --data-only -t auth.identities | psql -U postgres -d postgres -v ON_ERROR_STOP=0" > /tmp/auth_i.log 2>&1
echo "auth.identities load errors: $(grep -c '^ERROR' /tmp/auth_i.log)"; grep '^ERROR' /tmp/auth_i.log | head -5

echo "=== 5. reload PostgREST schema cache ==="
PSQL -d postgres -c "NOTIFY pgrst, 'reload schema';" >/dev/null 2>&1
[ -n "$REST" ] && SUDO docker restart "$REST" >/dev/null 2>&1 && echo "restarted $REST"

echo "=== 6. VERIFY live counts ==="
PSQL -d postgres -c "select 'public.users' t,count(*) from public.users union all select 'public.products',count(*) from public.products union all select 'public.customers',count(*) from public.customers union all select 'public.vendors',count(*) from public.vendors union all select 'public.sales_orders',count(*) from public.sales_orders union all select 'public.boms',count(*) from public.boms union all select 'auth.users',count(*) from auth.users union all select 'auth.identities',count(*) from auth.identities order by 1;"
echo "--- sample users (email/role) ---"
PSQL -d postgres -c "select email, role from public.users order by email;"

echo "=== 7. drop temp clone_src ==="
PSQL -d postgres -c "DROP DATABASE clone_src;"
SUDO docker exec "$DB" rm -f /tmp/pg_only.sql
echo DONE
"""
remote = remote.replace("__SID__", SID).replace("__PW__", sp).replace("__USER__", USER)

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)

# upload slice
print("Uploading slice via SFTP ...")
sftp = c.open_sftp()
sftp.putfo(io.BytesIO(slice_text.encode("utf-8")), f"/home/{USER}/pg_only.sql")
sftp.close()
print("uploaded /home/%s/pg_only.sql" % USER)

i, o, e = c.exec_command("bash -s", timeout=600); i.write(remote); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:\n" + err[:2000], file=sys.stderr)
c.close()
