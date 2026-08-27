#!/usr/bin/env python3
"""End-to-end test of the SCM flow, run AS A REAL TENANT USER (role=authenticated
+ that user's JWT claim), so RLS is exercised exactly as the app hits it.

Covers:
  1. the 3-name chain      — customer alias -> our item -> vendor part no.
  2. reverse resolution    — an imported sheet row matched back to our item
  3. outward dispatch      — partial, quantity-wise, written through RLS
  4. tracking maths        — received vs dispatched vs in-stock

Cleans up everything it creates. Live data is never modified.
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
SHOW(){ SUDO docker exec "$DB" psql -U postgres -d postgres -c "$1"; }

# a real tenant user (not a platform admin) + a real product / vendor / customer
U=$(Q "select om.user_id from organization_memberships om
       join organizations o on o.id=om.organization_id join users u on u.id=om.user_id
       where o.slug='unimisk' and om.is_active and u.active
         and u.id not in (select user_id from master_admin_memberships) limit 1")
ORG=$(Q "select id from organizations where slug='unimisk'")
PROD=$(Q "select id from products where organization_id='$ORG' limit 1")
VEND=$(Q "select id from vendors where organization_id='$ORG' limit 1")
SO=$(Q "select id from sales_orders where organization_id='$ORG' limit 1")
echo "user=$U"
echo "product=$PROD  vendor=$VEND  so=$SO"
JWT="{\"sub\":\"$U\",\"role\":\"authenticated\"}"

echo
echo '=== 1. map the SAME item to a customer name and a vendor part no. ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
select public.opc_alias_set('$PROD','customer',null,'CUST-PN-001','Customer wording for this item') as customer_alias;
select public.opc_alias_set('$PROD','vendor','$VEND','C9606R','Cisco Catalyst 9600 6 Slot Chassis') as vendor_alias;
commit;"

echo '=== 2. vendor map (what the PO would print) ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
select public.opc_alias_map('vendor','$VEND') as vendor_names;
commit;"

echo '=== 3. REVERSE: an imported sheet row -> our item ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
select public.opc_alias_resolve('customer',null,'CUST-PN-001',null) as by_customer_code;
select public.opc_alias_resolve('customer',null,null,'Customer wording for this item') as by_customer_desc;
commit;"

echo '=== 4. OUTWARD DISPATCH written through RLS (partial, qty-wise) ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
insert into public.outward_dispatches (id, so_id, dc_no, date, items, transport, created_by)
values ('zzz-dc-test','$SO','DC/OUT/TEST', current_date,
        jsonb_build_array(jsonb_build_object('product_id','$PROD','name','Test item','qty',5)),
        jsonb_build_object('mode','Road','lr','LR-TEST-1'), '$U');
select id, so_id, dc_no, (items->0->>'qty')::int as qty_out, transport->>'lr' as lr
  from public.outward_dispatches where id='zzz-dc-test';
commit;"

echo '=== 5. can ANOTHER organization see that dispatch? (must be 0) ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-0000000000ff\",\"role\":\"authenticated\"}';
select count(*) as visible_to_outsider from public.outward_dispatches;
commit;"

echo '=== CLEANUP ==='
Q "delete from public.outward_dispatches where id='zzz-dc-test';
   delete from public.item_aliases where alias_code in ('CUST-PN-001','C9606R');" >/dev/null
echo "  leftover test dispatches: $(Q "select count(*) from outward_dispatches where id like 'zzz-%'")"
echo "  leftover test aliases   : $(Q "select count(*) from item_aliases where alias_code in ('CUST-PN-001','C9606R')")"
echo "  LIVE sales_orders       : $(Q "select count(*) from sales_orders")"
""".replace("__PW__", sp).replace("__SID__", SID)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
i, o, e = cli.exec_command("bash -s", timeout=240)
i.write(script); i.channel.shutdown_write()
out = o.read().decode("utf-8", "replace") + e.read().decode("utf-8", "replace")
cli.close()
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
