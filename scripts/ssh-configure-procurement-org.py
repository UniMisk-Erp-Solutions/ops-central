#!/usr/bin/env python3
"""Put the procurement-only company onto its own workflow profile and feature set.

Scoped to ONE organization (default: the org on the `ml` subdomain). It prints
the other organizations' profiles before and after so it is visible that nothing
else moved.

Nothing here is hard-coded into the app: the profile and the flags are rows, so
the next company is another run of this with different arguments.

Usage:
  SSH_PASSWORD='...' python scripts/ssh-configure-procurement-org.py [subdomain]
"""
import os, sys
import paramiko

PW = os.environ.get("SSH_PASSWORD", "")
HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
SUB = (sys.argv[1] if len(sys.argv) > 1 else "ml").strip().lower()
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

# A procurement-only company: material in, material out. No presales, no RFQ,
# no site implementation, no invoicing from this system (deferred by the client).
FEATURES_OFF = ["presales", "rfq_email", "implementation", "cross_so_transfer",
                "partial_invoicing", "e_invoice", "e_way_bill", "whatsapp", "sms"]
FEATURES_ON = ["sales_desk", "stores", "scm_tracking", "item_mapping", "surplus_pool"]

sp = PW.replace("'", "'\"'\"'")
script = r"""
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-__SID__" | head -1)
Q(){ SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
SHOW(){ SUDO docker exec "$DB" psql -U postgres -d postgres -c "$1"; }

ORG=$(Q "select id from organizations where lower(trim(subdomain))='__SUB__' limit 1")
if [ -z "$ORG" ]; then echo "!! no organization on subdomain __SUB__"; exit 1; fi
NAME=$(Q "select name from organizations where id='$ORG'")
echo "target: $NAME  ($ORG)  [__SUB__]"

echo
echo '=== BEFORE — every organization ==='
SHOW "select name, coalesce(subdomain,'-') as subdomain, workflow_profile
        from organizations order by name;"

echo '=== applying ==='
Q "update organizations set workflow_profile='procurement_only', updated_at=now() where id='$ORG';" >/dev/null
echo "  profile -> procurement_only"

for k in __OFF__; do
  Q "insert into organization_features (organization_id, feature_key, enabled, updated_at)
     values ('$ORG', '$k', false, now())
     on conflict (organization_id, feature_key) do update set enabled=false, updated_at=now();" >/dev/null
  echo "  feature OFF  $k"
done
for k in __ON__; do
  Q "insert into organization_features (organization_id, feature_key, enabled, updated_at)
     values ('$ORG', '$k', true, now())
     on conflict (organization_id, feature_key) do update set enabled=true, updated_at=now();" >/dev/null
  echo "  feature ON   $k"
done

echo
echo '=== AFTER — every organization (only the target must have moved) ==='
SHOW "select name, coalesce(subdomain,'-') as subdomain, workflow_profile
        from organizations order by name;"

echo '=== resolved workflow for the target ==='
SHOW "select jsonb_pretty(public.opc_workflow_for('$ORG')) as effective_workflow;"

echo '=== its capabilities ==='
SHOW "select feature_key, enabled from organization_features
       where organization_id='$ORG' order by enabled desc, feature_key;"

echo '=== the standard org must be unchanged ==='
SHOW "select o.name, o.workflow_profile,
             public.opc_workflow_for(o.id)->>'receiving_flow'   as receiving,
             public.opc_workflow_for(o.id)->>'po_item_language' as po_language
        from organizations o where o.slug='unimisk';"

echo '=== data safety: nothing was touched ==='
echo "  sales_orders total : $(Q "select count(*) from sales_orders")"
echo "  vendor_pos total   : $(Q "select count(*) from vendor_pos")"
echo "  grns total         : $(Q "select count(*) from grns")"
""".replace("__PW__", sp).replace("__SID__", SID).replace("__SUB__", SUB) \
   .replace("__OFF__", " ".join(FEATURES_OFF)).replace("__ON__", " ".join(FEATURES_ON))

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
