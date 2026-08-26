#!/usr/bin/env python3
"""Prove FIX 1 works: opc_create_user must auto-create an org membership.

Calls the RPC exactly the way the app does — inside a transaction with
`SET LOCAL ROLE authenticated` + a JWT claim for a real admin — then inspects
the result as superuser (so RLS cannot hide the answer). Cleans up after itself.
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
\set ON_ERROR_STOP on
set client_min_messages = notice;

\echo '--- pre-clean any leftover probe ---'
delete from public.organization_memberships where user_id in (select id from public.users where email='zzz-probe@test.local');
delete from public.users where email='zzz-probe@test.local';
delete from auth.users where lower(email)='zzz-probe@test.local';

\echo ''
\echo '=== call opc_create_user AS THE ADMIN (role=authenticated + JWT claim) ==='
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"REPLACE_UID","role":"authenticated"}';
  select id, email, role from public.opc_create_user(
    'ZZZ Probe', 'zzz-probe@test.local', 'Str0ng!Pass123', 'Sales');
commit;

\echo ''
\echo '=== inspect AS SUPERUSER (RLS cannot hide it) ==='
select 'user row created'      as check, count(*)::text as value from public.users where email='zzz-probe@test.local'
union all
select 'membership rows (expect 1)', count(*)::text
  from public.organization_memberships m
  join public.users u on u.id = m.user_id where u.email='zzz-probe@test.local'
union all
select 'membership org = admin org', coalesce((
  select (m.organization_id = (select organization_id from public.organization_memberships
                               where user_id='REPLACE_UID' limit 1))::text
  from public.organization_memberships m
  join public.users u on u.id=m.user_id where u.email='zzz-probe@test.local' limit 1), 'n/a');

\echo ''
\echo '=== does that brand-new user actually SEE the org data? (not a blank app) ==='
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"REPLACE_NEW","role":"authenticated"}';
  select 'sales_orders visible to the new user' as what, count(*) from sales_orders;
commit;

\echo ''
\echo '=== CLEANUP ==='
delete from public.organization_memberships where user_id in (select id from public.users where email='zzz-probe@test.local');
delete from auth.users where id in (select id::uuid from public.users where email='zzz-probe@test.local');
delete from public.users where email='zzz-probe@test.local';
select 'probe left' as what, count(*) from public.users where email='zzz-probe@test.local'
union all select 'live users', count(*) from public.users
union all select 'live sales_orders', count(*) from sales_orders;
"""

sp = PW.replace("'", "'\"'\"'")
script = """#!/bin/bash
SUDO(){ echo '%s' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-%s" | head -1)
ADMIN=$(SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select user_id from master_admin_memberships limit 1")
echo "admin under test: $ADMIN"

cat > /tmp/fix1.sql <<'SQLEOF'
%s
SQLEOF
sed -i "s/REPLACE_UID/$ADMIN/g" /tmp/fix1.sql

# First pass creates the user; capture its id, then substitute for the visibility check.
SUDO docker cp /tmp/fix1.sql "$DB":/tmp/fix1a.sql >/dev/null
# run everything up to the visibility check with a placeholder that we resolve inline
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  delete from public.organization_memberships where user_id in (select id from public.users where email='zzz-probe@test.local');
  delete from public.users where email='zzz-probe@test.local';
  delete from auth.users where lower(email)='zzz-probe@test.local';" >/dev/null

echo '=== calling opc_create_user as the admin ==='
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
begin;
set local role authenticated;
set local request.jwt.claims = '{\\"sub\\":\\"$ADMIN\\",\\"role\\":\\"authenticated\\"}';
select id, email, role from public.opc_create_user('ZZZ Probe','zzz-probe@test.local','Str0ng!Pass123','Sales');
commit;"

NEWID=$(SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select id from public.users where email='zzz-probe@test.local'")
echo "new user id: $NEWID"

echo '=== inspect as superuser ==='
SUDO docker exec "$DB" psql -U postgres -d postgres -c "
select 'user row created' as check, count(*)::text as value from public.users where email='zzz-probe@test.local'
union all select 'membership rows (expect 1)', count(*)::text from public.organization_memberships where user_id='$NEWID'
union all select 'membership role', coalesce(max(role),'(none)') from public.organization_memberships where user_id='$NEWID'
union all select 'same org as admin', coalesce((select (m.organization_id=(select organization_id from public.organization_memberships where user_id='$ADMIN' limit 1))::text from public.organization_memberships m where m.user_id='$NEWID' limit 1),'n/a');"

echo '=== can the NEW user see org data? (blank-app check) ==='
SUDO docker exec "$DB" psql -U postgres -d postgres -c "
begin;
set local role authenticated;
set local request.jwt.claims = '{\\"sub\\":\\"$NEWID\\",\\"role\\":\\"authenticated\\"}';
select 'sales_orders visible to new user' as what, count(*) from sales_orders;
commit;"

echo '=== CLEANUP ==='
SUDO docker exec "$DB" psql -U postgres -d postgres -c "
delete from public.organization_memberships where user_id='$NEWID';
delete from auth.users where id='$NEWID'::uuid;
delete from public.users where id='$NEWID';
select 'probe left' as what, count(*) from public.users where email='zzz-probe@test.local'
union all select 'live users', count(*) from public.users
union all select 'live sales_orders', count(*) from sales_orders;"
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
