#!/usr/bin/env python3
"""Prove the platform console's feature checkboxes actually gate a tenant.

Creates a throwaway org whose feature set is chosen at creation (some ticked,
some not), adds a user to it, then reads opc_my_features() AS THAT USER — which
is exactly what the app calls to build the nav. Cleans up afterwards.

NOTE: the tenant's user id is resolved BEFORE switching role. Doing it inside a
`set local role authenticated` block would itself be RLS-filtered and yield a
null subject, which silently makes the test meaningless.
"""
import os, sys
import paramiko

PW = os.environ.get("SSH_PASSWORD", "")
HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

sp = PW.replace("'", "'\"'\"'")
script = r"""
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-__SID__" | head -1)
Q(){ SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
M=$(Q "select user_id from master_admin_memberships limit 1")

# ---- clean slate -----------------------------------------------------------
Q "delete from organizations where slug='zzz-feat';
   delete from organization_memberships where user_id in (select id from public.users where email like 'zzz-feat%');
   delete from auth.users where email like 'zzz-feat%';
   delete from public.users where email like 'zzz-feat%';" >/dev/null

echo '=== 1. platform admin creates an org with only SOME features ticked ==='
echo '    ticked: presales, sales_desk, stores   |   UNticked: surplus_pool, cross_so_transfer'
Q "begin;
   set local role authenticated;
   set local request.jwt.claims = '{\"sub\":\"$M\",\"role\":\"authenticated\"}';
   select public.opc_admin_create_org('ZZZ Feature Co','zzz-feat',null,'starter',
     '{\"presales\":true,\"sales_desk\":true,\"stores\":true,\"surplus_pool\":false,\"cross_so_transfer\":false}'::jsonb,
     null);
   select public.opc_admin_create_user(
     (select id from public.organizations where slug='zzz-feat'),
     'Feat Tester','zzz-feat@test.local','FeatPass!2345','Sales','admin');
   commit;" | tail -2

# resolve the tenant user id as SUPERUSER, before any role switch
U=$(Q "select id from public.users where email='zzz-feat@test.local'")
echo "    tenant user: $U"

echo
echo '=== 2. what the TENANT USER receives (this builds their nav) ==='
SUDO docker exec "$DB" psql -U postgres -d postgres -c "
begin;
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"$U\",\"role\":\"authenticated\"}';
select key, value as enabled from jsonb_each_text(public.opc_my_features()) order by key;
commit;"

echo '=== 3. platform admin ticks surplus_pool ON ==='
Q "begin;
   set local role authenticated;
   set local request.jwt.claims = '{\"sub\":\"$M\",\"role\":\"authenticated\"}';
   select public.opc_admin_set_feature((select id from organizations where slug='zzz-feat'),'surplus_pool',true);
   commit;" >/dev/null
echo "    tenant now sees surplus_pool = $(SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "
begin;
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"$U\",\"role\":\"authenticated\"}';
select public.opc_my_features()->>'surplus_pool';
commit;" | tr -d '[:space:]')"

echo
echo '=== 4. CLEANUP ==='
Q "delete from organizations where slug='zzz-feat';
   delete from organization_memberships where user_id='$U';
   delete from auth.users where id='$U'::uuid;
   delete from public.users where id='$U';" >/dev/null
echo "    leftover test orgs: $(Q "select count(*) from organizations where slug like 'zzz-%'")"
echo "    LIVE sales_orders : $(Q "select count(*) from sales_orders")"
""".replace("__PW__", sp).replace("__SID__", SID)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
i, o, e = cli.exec_command("bash -s", timeout=180)
i.write(script); i.channel.shutdown_write()
out = o.read().decode("utf-8", "replace") + e.read().decode("utf-8", "replace")
cli.close()
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
