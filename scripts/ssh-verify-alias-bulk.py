#!/usr/bin/env python3
"""Prove the batch matcher returns EXACTLY what the one-at-a-time matcher did.

The import was made faster by replacing N sequential opc_alias_resolve calls
with a single opc_alias_resolve_bulk. Faster is worthless if it matches
differently, so this runs both over the same rows, as a real tenant user (RLS
active), and compares them row by row.

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

ORG=$(Q "select id from organizations where slug='unimisk'")
U=$(Q "select om.user_id from organization_memberships om join users u on u.id=om.user_id
       where om.organization_id='$ORG' and om.is_active and u.active
         and u.id not in (select user_id from master_admin_memberships) limit 1")
CUST=$(Q "select id from customers where organization_id='$ORG' limit 1")
P1=$(Q "select id from products where organization_id='$ORG' order by id limit 1")
P2=$(Q "select id from products where organization_id='$ORG' order by id offset 1 limit 1")
C1=$(Q "select code from products where organization_id='$ORG' order by id limit 1")
N2=$(Q "select name from products where organization_id='$ORG' order by id offset 1 limit 1")
JWT="{\"sub\":\"$U\",\"role\":\"authenticated\"}"
echo "user=$U customer=$CUST"
echo "p1=$P1 (code $C1)   p2=$P2"

echo
echo '=== seed two customer aliases, in ONE bulk call ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
select public.opc_alias_set_bulk('customer','$CUST', jsonb_build_array(
   jsonb_build_object('product_id','$P1','code','ZZZBULK-A','name','Bulk alias A','uom','Nos.'),
   jsonb_build_object('product_id','$P2','code','ZZZBULK-B','name','Bulk alias B','uom','Nos.'),
   -- the same item twice, as a real sheet repeats a line
   jsonb_build_object('product_id','$P1','code','ZZZBULK-A','name','Bulk alias A','uom','Nos.')
)) as bulk_set;
commit;"

echo '=== the two matchers, over the same six rows ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '$JWT';
with rows(k, code, name) as (values
  ('a','ZZZBULK-A', null),                 -- this customer's part number
  ('b', null, 'Bulk alias B'),             -- this customer's wording
  ('c','$C1', null),                       -- our own code
  ('d', null, '$N2'),                      -- our own name
  ('e','NO-SUCH-CODE','No such item'),     -- genuinely unknown
  ('f', null, null)                        -- empty row
)
select r.k,
       coalesce(public.opc_alias_resolve('customer','$CUST', r.code, r.name)->>'product_id','-') as one_at_a_time,
       coalesce(public.opc_alias_resolve('customer','$CUST', r.code, r.name)->>'matched_by','-') as how_single,
       coalesce((select public.opc_alias_resolve_bulk('customer','$CUST',
           (select jsonb_agg(jsonb_build_object('k',k,'code',code,'name',name)) from rows))->r.k->>'product_id'),'-') as bulk,
       coalesce((select public.opc_alias_resolve_bulk('customer','$CUST',
           (select jsonb_agg(jsonb_build_object('k',k,'code',code,'name',name)) from rows))->r.k->>'matched_by'),'-') as how_bulk,
       case when coalesce(public.opc_alias_resolve('customer','$CUST', r.code, r.name)->>'product_id','-')
               = coalesce((select public.opc_alias_resolve_bulk('customer','$CUST',
                   (select jsonb_agg(jsonb_build_object('k',k,'code',code,'name',name)) from rows))->r.k->>'product_id'),'-')
            then 'SAME' else '*** DIFFERENT ***' end as verdict
  from rows r order by r.k;
commit;"

echo '=== another organization must match NOTHING here ==='
SHOW "
begin;
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-0000000000ff\",\"role\":\"authenticated\"}';
select public.opc_alias_resolve_bulk('customer','$CUST',
  jsonb_build_array(jsonb_build_object('k','a','code','ZZZBULK-A','name',null))) as outsider_sees;
commit;"

echo '=== CLEANUP ==='
Q "delete from item_aliases where alias_code like 'ZZZBULK-%';" >/dev/null
echo "  leftover test aliases : $(Q "select count(*) from item_aliases where alias_code like 'ZZZBULK-%'")"
echo "  LIVE products         : $(Q "select count(*) from products")"
echo "  LIVE item_aliases     : $(Q "select count(*) from item_aliases")"
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
