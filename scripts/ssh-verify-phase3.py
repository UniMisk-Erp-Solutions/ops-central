#!/usr/bin/env python3
"""Verify Phase 3 tenant isolation on the SO-PO DB (READ-ONLY).

Impersonates a real logged-in user at the Postgres level (role `authenticated`
plus a JWT claim for their uuid) and checks that RLS returns their org's rows —
the same path PostgREST uses. Then checks that a user in NO organization sees
nothing, which is what proves isolation actually works.

Writes nothing.
"""
import os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

SQL = r"""
\echo '=== policies now in force (expect tenant_all_*) ==='
select tablename, policyname from pg_policies
 where schemaname='public' and tablename in ('sales_orders','sourcings','customers','config','users')
 order by tablename, policyname;

\echo ''
\echo '=== organization_id is NOT NULL ==='
select table_name, is_nullable from information_schema.columns
 where table_schema='public' and column_name='organization_id'
   and table_name in ('sales_orders','sourcings','rfqs','pool','audit')
 order by table_name;

\echo ''
\echo '=== AS A REAL MEMBER (existing admin) — must still see the data ==='
do $$
declare uid text; n_so int; n_src int; n_cust int; n_usr int;
begin
  select user_id into uid from master_admin_memberships limit 1;
  raise notice 'impersonating user_id=%', uid;
end $$;

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"REPLACE_UID","role":"authenticated"}';
  select 'sales_orders visible' as what, count(*) from sales_orders
  union all select 'sourcings visible', count(*) from sourcings
  union all select 'customers visible', count(*) from customers
  union all select 'users visible', count(*) from users
  union all select 'config rows visible', count(*) from config;
commit;

\echo ''
\echo '=== AS A USER WITH NO MEMBERSHIP — must see ZERO (isolation proof) ==='
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}';
  select 'sales_orders visible' as what, count(*) from sales_orders
  union all select 'sourcings visible', count(*) from sourcings
  union all select 'customers visible', count(*) from customers;
commit;
"""

sp = PW.replace("'", "'\"'\"'")
script = """#!/bin/bash
SUDO(){ echo '%s' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-%s" | head -1)
UID_VAL=$(SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select user_id from master_admin_memberships limit 1")
echo "member under test: $UID_VAL"
cat > /tmp/verify.sql <<'SQLEOF'
%s
SQLEOF
sed -i "s/REPLACE_UID/$UID_VAL/g" /tmp/verify.sql
SUDO docker cp /tmp/verify.sql "$DB":/tmp/verify.sql >/dev/null
SUDO docker exec "$DB" psql -U postgres -d postgres -f /tmp/verify.sql
echo DONE
""" % (sp, SID, SQL)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
stdin, stdout, stderr = cli.exec_command("bash -s", timeout=180)
stdin.write(script); stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", "replace") + stderr.read().decode("utf-8", "replace")
cli.close()
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
