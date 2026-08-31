#!/usr/bin/env python3
"""Prove that a sales order written the way the importer writes it now lands in
the database — and that the old shape really was the reason it did not.

An imported order existed in one browser and nowhere else. The row carried
imported_from / po_ref / created_by, none of which are columns of sales_orders,
so PostgREST rejected it while the products and customer around it saved. The
failure only reached the browser console.

This runs AS A REAL TENANT USER (RLS active) and shows:
  1. the old payload is rejected — the bug was real, not a guess
  2. the same payload filtered to real columns inserts cleanly
  3. opc_sync_columns returns what the client needs to do that filtering
  4. the order is then visible to ANOTHER user of the same organization
     (which is the actual complaint: it must not be per-browser)
  5. and invisible to a different organization

Cleans up everything it creates.
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
Q(){ SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }
SHOW(){ SUDO docker exec "$DB" psql -U postgres -d postgres -c "$1"; }

ML=$(Q "select id from organizations where subdomain='ml'")
U1=$(Q "select user_id from organization_memberships where organization_id='$ML' and is_active order by user_id limit 1")
U2=$(Q "select user_id from organization_memberships where organization_id='$ML' and is_active order by user_id offset 1 limit 1")
CUST=$(Q "select id from customers where organization_id='$ML' limit 1")
J1="{\"sub\":\"$U1\",\"role\":\"authenticated\"}"
J2="{\"sub\":\"$U2\",\"role\":\"authenticated\"}"
echo "org=$ML"
echo "user A=$U1"
echo "user B=$U2   (a different person in the SAME organization)"
echo "customer=$CUST"

echo
echo '=== 1. the OLD payload — with imported_from / po_ref / created_by ==='
SUDO docker exec "$DB" psql -U postgres -d postgres -c "
begin;
set local role authenticated;
set local request.jwt.claims = '$J1';
insert into public.sales_orders (id, so_no, customer_id, date, status, priority, lines,
                                 imported_from, po_ref, created_by)
values ('zzz-so-old','ZZZ/OLD','$CUST', current_date, 'Draft','Standard','[]'::jsonb,
        'sheet.xlsx','', '$U1');
commit;" 2>&1 | grep -iE "ERROR|does not exist" | head -2
echo "  rows inserted by the old shape: $(Q "select count(*) from sales_orders where id='zzz-so-old'")  (must be 0)"

echo
echo '=== 2. the NEW payload — only real columns, extras inside extra ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$J1';
insert into public.sales_orders (id, so_no, customer_id, customer_po, date, expected,
                                 status, priority, order_type, lines, extra)
values ('zzz-so-new','ZZZ/NEW','$CUST','', current_date, current_date,
        'Draft','Standard','Supply',
        '[{\"id\":\"l1\",\"bundle_qty\":1,\"components\":[{\"product_id\":\"p1\",\"qty\":2}]}]'::jsonb,
        jsonb_build_object('imported', jsonb_build_object('file','sheet.xlsx','rows',33)));
select id, so_no, status, extra->'imported'->>'file' as imported_from
  from public.sales_orders where id='zzz-so-new';
commit;"

echo '=== 3. what opc_sync_columns tells the client about sales_orders ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$J1';
select public.opc_sync_columns()->'sales_orders' as sales_order_columns;
commit;"
echo "  imported_from listed as a column? $(Q "select (public.opc_sync_columns()->'sales_orders') @> '[\"imported_from\"]'::jsonb")  (must be false)"
echo "  extra listed as a column?         $(Q "select (public.opc_sync_columns()->'sales_orders') @> '[\"extra\"]'::jsonb")  (must be true)"

echo
echo '=== 4. can a DIFFERENT USER of the same org see it? (the actual complaint) ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$J2';
select count(*) as user_b_sees, max(so_no) as so_no
  from public.sales_orders where id='zzz-so-new';
commit;"

echo '=== 5. can another ORGANIZATION see it? (must be 0) ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-0000000000ff\",\"role\":\"authenticated\"}';
select count(*) as outsider_sees from public.sales_orders where id='zzz-so-new';
commit;"

echo '=== CLEANUP ==='
Q "delete from public.sales_orders where id like 'zzz-so-%';" >/dev/null
echo "  leftover test orders : $(Q "select count(*) from sales_orders where id like 'zzz-so-%'")"
echo "  LIVE sales_orders    : $(Q "select count(*) from sales_orders")"
echo "  microlink orders     : $(Q "select count(*) from sales_orders where organization_id='$ML'")"
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
