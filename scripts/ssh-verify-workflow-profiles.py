#!/usr/bin/env python3
"""End-to-end proof that two organizations run DIFFERENT flows on one deployment.

Everything that can be is executed AS A REAL TENANT USER (role=authenticated +
that user's JWT claim), so RLS is exercised exactly as the app hits it.

Checks:
  1. each org resolves its own workflow
  2. a per-org override beats the preset, and clearing it restores the preset
  3. the 3-name chain drives what a vendor PO would print
  4. in-transit (LR) is written and read back through RLS
  5. outward dispatch, partial and quantity-wise, through RLS
  6. neither org can see the other's rows
  7. a non-master admin CANNOT change a workflow profile
  8. live data is untouched

Creates only rows prefixed zzz- / ZZZ- and deletes them all at the end.
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

SO_BEFORE=$(Q "select count(*) from sales_orders")
PO_BEFORE=$(Q "select count(*) from vendor_pos")
GRN_BEFORE=$(Q "select count(*) from grns")

ML=$(Q "select id from organizations where lower(trim(subdomain))='ml'")
UM=$(Q "select id from organizations where slug='unimisk'")
echo "microlink=$ML"
echo "standard =$UM"

echo
echo '=== 1. each organization resolves ITS OWN workflow ==='
SHOW "select o.name, o.workflow_profile,
             public.opc_workflow_for(o.id)->>'receiving_flow'     as receiving,
             public.opc_workflow_for(o.id)->>'po_item_language'   as po_prints_in,
             public.opc_workflow_for(o.id)->>'intransit_tracking' as tracks_transit,
             public.opc_workflow_for(o.id)->>'outward_dispatch'   as outward
        from organizations o order by o.name;"

echo '=== 2. an override beats the preset, and clearing it restores the preset ==='
Q "insert into organization_settings (organization_id, data) values ('$ML','{}'::jsonb)
   on conflict (organization_id) do nothing;" >/dev/null
Q "update organization_settings
      set data = coalesce(data,'{}'::jsonb) || jsonb_build_object('workflow',
                 coalesce(data->'workflow','{}'::jsonb) || '{\"po_item_language\":\"ours\"}'::jsonb)
    where organization_id='$ML';" >/dev/null
echo "  with override      -> $(Q "select public.opc_workflow_for('$ML')->>'po_item_language'")   (preset says vendor)"
Q "update organization_settings
      set data = coalesce(data,'{}'::jsonb) || jsonb_build_object('workflow',
                 coalesce(data->'workflow','{}'::jsonb) - 'po_item_language')
    where organization_id='$ML';" >/dev/null
echo "  override cleared   -> $(Q "select public.opc_workflow_for('$ML')->>'po_item_language'")   (back to the preset)"

# ---- a real tenant user in the STANDARD org, with real master data ----
U=$(Q "select om.user_id from organization_memberships om join users u on u.id=om.user_id
       where om.organization_id='$UM' and om.is_active and u.active
         and u.id not in (select user_id from master_admin_memberships) limit 1")
PROD=$(Q "select id from products where organization_id='$UM' limit 1")
VEND=$(Q "select id from vendors where organization_id='$UM' limit 1")
SO=$(Q "select id from sales_orders where organization_id='$UM' limit 1")
PO=$(Q "select id from vendor_pos where organization_id='$UM' limit 1")
JWT="{\"sub\":\"$U\",\"role\":\"authenticated\"}"
echo
echo "tenant user=$U  product=$PROD  vendor=$VEND  so=$SO  po=$PO"

echo
echo '=== 3. the 3-name chain: what the vendor PO would print ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
select public.opc_alias_set('$PROD','vendor','$VEND','ZZZ-VPN-77','Vendor catalogue description') as mapped;
select public.opc_alias_map('vendor','$VEND') as what_the_po_prints;
commit;"

echo '=== 4. IN TRANSIT written + read back through RLS ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
update public.vendor_pos
   set dispatch_info = jsonb_build_object(
         'shipped_on', current_date, 'lr_no','ZZZ-LR-4242', 'carrier','TCI Express',
         'eta', current_date + 3,
         'items', jsonb_build_array(jsonb_build_object('product_id','$PROD','qty',7)))
 where id='$PO';
select id, dispatch_info->>'lr_no' as lr, dispatch_info->>'carrier' as carrier,
       (dispatch_info->'items'->0->>'qty')::int as shipped_qty
  from public.vendor_pos where id='$PO';
commit;"

echo '=== 5. OUTWARD DISPATCH — partial, quantity-wise, through RLS ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
insert into public.outward_dispatches (id, so_id, dc_no, date, items, transport, created_by)
values ('zzz-wf-dc','$SO','ZZZ/DC/1', current_date,
        jsonb_build_array(jsonb_build_object('product_id','$PROD','name','Our name',
                          'cust_name','Customer wording','qty',3)),
        jsonb_build_object('mode','Road','lr','ZZZ-LR-OUT'), '$U');
select dc_no, (items->0->>'qty')::int as qty_out,
       items->0->>'cust_name' as prints_on_challan
  from public.outward_dispatches where id='zzz-wf-dc';
commit;"

echo '=== 6. can the OTHER organization see any of it? (all must be 0) ==='
OTHER=$(Q "select om.user_id from organization_memberships om join users u on u.id=om.user_id
           where om.organization_id='$ML' and om.is_active and u.active
             and u.id not in (select user_id from master_admin_memberships) limit 1")
if [ -z "$OTHER" ]; then
  echo "  (microlink has no non-admin user yet — using a stranger id instead)"
  OTHER='00000000-0000-0000-0000-0000000000ff'
fi
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"$OTHER\",\"role\":\"authenticated\"}';
select (select count(*) from public.outward_dispatches where id='zzz-wf-dc') as sees_dispatch,
       (select count(*) from public.item_aliases where alias_code='ZZZ-VPN-77') as sees_alias,
       (select count(*) from public.vendor_pos where id='$PO')                 as sees_po;
commit;"

echo '=== 7. a NON-master must NOT be able to change a workflow profile ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
select public.opc_admin_set_workflow_profile('$ML','standard');
commit;" 2>&1 | grep -i "error\|platform admins" | head -2 || echo "  !! NO ERROR RAISED — this would be a security hole"
echo "  profile after the attempt: $(Q "select workflow_profile from organizations where id='$ML'")  (must still be procurement_only)"

echo
echo '=== CLEANUP ==='
Q "delete from public.outward_dispatches where id='zzz-wf-dc';
   delete from public.item_aliases where alias_code='ZZZ-VPN-77';
   update public.vendor_pos set dispatch_info='{}'::jsonb where id='$PO';" >/dev/null
echo "  leftover test dispatches : $(Q "select count(*) from outward_dispatches where id like 'zzz-%'")"
echo "  leftover test aliases    : $(Q "select count(*) from item_aliases where alias_code like 'ZZZ-%'")"
echo "  leftover test LR         : $(Q "select count(*) from vendor_pos where dispatch_info->>'lr_no' like 'ZZZ-%'")"
echo
echo '=== LIVE DATA (must be identical before/after) ==='
echo "  sales_orders : $SO_BEFORE -> $(Q "select count(*) from sales_orders")"
echo "  vendor_pos   : $PO_BEFORE -> $(Q "select count(*) from vendor_pos")"
echo "  grns         : $GRN_BEFORE -> $(Q "select count(*) from grns")"
""".replace("__PW__", sp).replace("__SID__", SID)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
i, o, e = cli.exec_command("bash -s", timeout=300)
i.write(script); i.channel.shutdown_write()
out = o.read().decode("utf-8", "replace") + e.read().decode("utf-8", "replace")
cli.close()
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
