#!/usr/bin/env python3
"""Apply the multi-tenancy migrations (017, 018, 019) to the SO-PO DB ONLY.

Phases 1 + 2: purely ADDITIVE.
  017 — tenancy control plane (new tables/functions only)
  018 — RPCs + adopt the current install as the default tenant
  019 — nullable organization_id on tenant tables + backfill + auto-stamp default

No existing table definition, policy or grant is modified, so the running app is
unaffected. Each file runs with ON_ERROR_STOP=1 inside a transaction; all three
are idempotent and re-runnable. Prints a verification report at the end.

Strictly scoped to the SO-PO service id — no other stack is touched.

Run:  SSH_PASSWORD='...' python scripts/ssh-apply-tenancy.py
"""
import base64, os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

FILES = [
    "supabase/migrations/017_multitenancy_foundation.sql",
    "supabase/migrations/018_multitenancy_rpcs_seed.sql",
    "supabase/migrations/019_org_id_columns.sql",
]

blocks = []
for path in FILES:
    with open(path, "rb") as f:
        blocks.append((os.path.basename(path), base64.b64encode(f.read()).decode("ascii")))

VERIFY = (
    "select '--- organizations ---'; "
    "select id, name, slug, coalesce(subdomain,'(shared host)') as subdomain, status from organizations; "
    "select '--- memberships / master admins ---'; "
    "select (select count(*) from organization_memberships) as memberships, "
    "(select count(*) from master_admin_memberships) as master_admins, "
    "(select count(*) from organization_settings) as settings_rows, "
    "(select count(*) from organization_features) as feature_rows; "
    "select '--- tenant tables: rows still missing organization_id (must all be 0) ---'; "
    "select c.relname as table_name, "
    "  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where organization_id is null', c.relname), false, true, '')))[1]::text::int as null_org_rows "
    "from pg_class c join pg_namespace n on n.oid = c.relnamespace "
    "join information_schema.columns col on col.table_schema='public' and col.table_name=c.relname and col.column_name='organization_id' "
    "where n.nspname='public' and c.relkind='r' order by c.relname;"
)

sp = PW.replace("'", "'\"'\"'")
parts = ["""#!/bin/bash
set -e
SID='%s'
SUDO(){ echo '%s' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-$SID" | head -1)
if [ -z "$DB" ]; then echo "SO-PO DB container not found"; exit 1; fi
echo "Target DB container: $DB"
echo
""" % (SID, sp)]

for name, b64 in blocks:
    parts.append("""echo "===== applying %s ====="
cat > /tmp/tmig.b64 <<'B64EOF'
%s
B64EOF
base64 -d /tmp/tmig.b64 > /tmp/tmig.sql
SUDO docker cp /tmp/tmig.sql "$DB":/tmp/tmig.sql >/dev/null
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f /tmp/tmig.sql
echo "----- %s OK -----"
echo
""" % (name, b64, name))

parts.append("""echo "===== VERIFICATION ====="
SUDO docker exec "$DB" psql -U postgres -d postgres -c "%s"
echo DONE
""" % VERIFY.replace('"', '\\"'))

script = "".join(parts)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
stdin, stdout, stderr = cli.exec_command("bash -s", timeout=300)
stdin.write(script); stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
cli.close()
if err.strip():
    out += "\n--- stderr ---\n" + err
with open("scripts/_tenancy_apply.out.txt", "w", encoding="utf-8") as f:
    f.write(out)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
