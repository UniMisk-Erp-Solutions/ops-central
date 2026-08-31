#!/usr/bin/env python3
"""Persist the frontend's built-in catalogue into ONE organization's database.

Why this exists
---------------
products / categories / boms were never in the frontend's LOADED_TABLES, so they
were only ever populated from seed.js. The demo organization has therefore been
running on a catalogue that was never fully written to the database: its orders
reference 24 products and 7 categories that exist only in that file.

Now that master data is read per-organization from the database — which is what
makes a second tenant possible at all — those references have to resolve. This
inserts the missing rows for ONE organization and touches nothing else:

  * scoped to a single organization (default: slug 'unimisk', the demo org)
  * INSERT ... ON CONFLICT DO NOTHING — a row already in the database wins, so
    anything edited there is never overwritten
  * prints dangling reference counts before and after

A brand-new tenant deliberately gets NOTHING. An empty catalogue is correct for
them; they load their own.

Usage:
  node scripts/uitest/dump-seed-masters.js frontend /tmp/seed.json
  SSH_PASSWORD='...' python scripts/ssh-backfill-master-data.py /tmp/seed.json [slug]
"""
import json, os, sys
import paramiko

PW = os.environ.get("SSH_PASSWORD", "")
HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)
if len(sys.argv) < 2:
    print(__doc__, file=sys.stderr); sys.exit(2)

SEED_FILE = sys.argv[1]
SLUG = (sys.argv[2] if len(sys.argv) > 2 else "unimisk").strip().lower()
seed = json.load(open(SEED_FILE, encoding="utf-8"))


def q(v):
    """Quote a value as a SQL literal."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def jq(v):
    return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"


stmts = []
for p in seed.get("products", []):
    stmts.append(
        "insert into products (organization_id, id, code, name, hsn, uom, gst, sell, buy) values "
        f"(:ORG:, {q(p.get('id'))}, {q(p.get('code'))}, {q(p.get('name'))}, {q(p.get('hsn'))}, "
        f"{q(p.get('uom'))}, {q(p.get('gst'))}, {q(p.get('sell'))}, {q(p.get('buy'))}) "
        "on conflict (organization_id, id) do nothing;")
for c in seed.get("categories", []):
    stmts.append(
        "insert into categories (organization_id, id, name, hsn, gst, bundle_desc) values "
        f"(:ORG:, {q(c.get('id'))}, {q(c.get('name'))}, {q(c.get('hsn'))}, {q(c.get('gst'))}, "
        f"{q(c.get('bundle_desc'))}) on conflict (organization_id, id) do nothing;")
boms = seed.get("boms") or {}
if isinstance(boms, dict):
    for cat_id, comps in boms.items():
        stmts.append(
            "insert into boms (organization_id, category_id, components) values "
            f"(:ORG:, {q(cat_id)}, {jq(comps)}) on conflict (organization_id, category_id) do nothing;")

sql_body = "\n".join(stmts)
print(f"prepared {len(stmts)} insert(s) for slug '{SLUG}'")

DANGLING = """
select 'so_products' as what, count(*) from (
  select distinct c->>'product_id' as pid from sales_orders o,
    lateral jsonb_array_elements(coalesce(o.lines,'[]'::jsonb)) l,
    lateral jsonb_array_elements(coalesce(l->'components','[]'::jsonb)) c
  where o.organization_id = (select id from organizations where slug = SLUGQ)) r
 where r.pid is not null and not exists (
   select 1 from products p where p.id = r.pid
     and p.organization_id = (select id from organizations where slug = SLUGQ))
union all
select 'so_categories', count(*) from (
  select distinct l->>'category_id' as cid from sales_orders o,
    lateral jsonb_array_elements(coalesce(o.lines,'[]'::jsonb)) l
  where o.organization_id = (select id from organizations where slug = SLUGQ)) r
 where r.cid is not null and not exists (
   select 1 from categories c where c.id = r.cid
     and c.organization_id = (select id from organizations where slug = SLUGQ))
union all
select 'po_products', count(*) from (
  select distinct i->>'product_id' as pid from vendor_pos v,
    lateral jsonb_array_elements(coalesce(v.items,'[]'::jsonb)) i
  where v.organization_id = (select id from organizations where slug = SLUGQ)) r
 where r.pid is not null and not exists (
   select 1 from products p where p.id = r.pid
     and p.organization_id = (select id from organizations where slug = SLUGQ));
""".replace("SLUGQ", q(SLUG))

script = f"""
SUDO(){{ echo {q(PW)} | sudo -S "$@" 2>/dev/null; }}
DB=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-db-{SID}" | head -1)
if [ -z "$DB" ]; then echo "SO-PO DB container not found"; exit 1; fi
RUN(){{ SUDO docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }}

ORG=$(RUN -tAc "select id from organizations where slug = {q(SLUG)}")
if [ -z "$ORG" ]; then echo "!! no organization with slug {SLUG}"; exit 1; fi
echo "target org: $ORG  ({SLUG})"

echo
echo '=== BEFORE ==='
RUN -c "select o.name,
          (select count(*) from products p where p.organization_id=o.id) as products,
          (select count(*) from categories c where c.organization_id=o.id) as categories,
          (select count(*) from boms b where b.organization_id=o.id) as boms
        from organizations o order by o.name;"
echo '--- dangling references ---'
RUN -c "{DANGLING}"

echo '=== applying (scoped to this organization, ON CONFLICT DO NOTHING) ==='
# The SQL is uploaded as a FILE. Piping it into psql cannot work here: SUDO
# feeds the password on stdin, so `docker exec -i ... -f -` would read the
# password instead of the statements — and fail silently.
sed "s/:ORG:/'$ORG'/g" /tmp/opc_masters_in.sql > /tmp/opc_masters.sql
SUDO docker cp /tmp/opc_masters.sql "$DB":/tmp/opc_masters.sql
RUN -q -v ON_ERROR_STOP=1 -1 -f /tmp/opc_masters.sql && echo "  applied" || echo "  !! FAILED"
SUDO docker exec "$DB" rm -f /tmp/opc_masters.sql
rm -f /tmp/opc_masters.sql /tmp/opc_masters_in.sql

echo
echo '=== AFTER ==='
RUN -c "select o.name,
          (select count(*) from products p where p.organization_id=o.id) as products,
          (select count(*) from categories c where c.organization_id=o.id) as categories,
          (select count(*) from boms b where b.organization_id=o.id) as boms
        from organizations o order by o.name;"
echo '--- dangling references (all must be 0) ---'
RUN -c "{DANGLING}"
echo '--- transactional data untouched ---'
echo "  sales_orders: $(RUN -tAc 'select count(*) from sales_orders')"
echo "  vendor_pos  : $(RUN -tAc 'select count(*) from vendor_pos')"
echo "  grns        : $(RUN -tAc 'select count(*) from grns')"
"""

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)

# Upload the statements as a file (see the note in the script above).
sftp = cli.open_sftp()
with sftp.open("/tmp/opc_masters_in.sql", "w") as fh:
    fh.write(sql_body)
sftp.close()

i, o, e = cli.exec_command("bash -s", timeout=300)
i.write(script); i.channel.shutdown_write()
out = o.read().decode("utf-8", "replace") + e.read().decode("utf-8", "replace")
cli.close()
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
