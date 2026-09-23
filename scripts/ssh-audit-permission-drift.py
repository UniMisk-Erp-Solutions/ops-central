#!/usr/bin/env python3
"""READ-ONLY: find per-organization permission overrides that have fallen
behind the shared PERMISSIONS table -- the exact bug class that silently took
convertClientRequest away from Purchase on Demo Org (see docs/client-requests.md).

`config.data.permissions.<Role>.can` / `.nav` are WHOLE-OBJECT overrides
(perm() in frontend/src/permissions.jsx merges nothing): once an admin
customises a role for one organization, that override is frozen at whatever
the base role had on the day it was written. Every capability or nav id added
to the base role afterward is invisible to that organization until someone
notices and updates the override by hand.

This does NOT auto-fix anything -- an override can also be a DELIBERATE
restriction (OP Central Demo's hand-tuned per-role overrides, for instance,
omit capabilities on purpose), so only a human reading this report can tell
"forgot to add" from "meant to leave out". It prints what changed and lets you
decide.

Usage:
  node scripts/uitest/dump-permissions.js frontend > /tmp/base-permissions.json
  SSH_PASSWORD='...' python scripts/ssh-audit-permission-drift.py /tmp/base-permissions.json
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

base = json.load(open(sys.argv[1], encoding="utf-8"))

sql = """
select o.slug, o.name, coalesce(c.data->'permissions', '{}'::jsonb)::text
from public.organizations o
left join public.config c on c.organization_id = o.id
order by o.slug;
"""
sp = PW.replace("'", "'\"'\"'")
script = """#!/bin/bash
SID='%s'
SUDO(){ echo '%s' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-$SID" | head -1)
if [ -z "$DB" ]; then echo "SO-PO DB container not found" >&2; exit 1; fi
cat > /tmp/audit.sql <<'SQLEOF'
%s
SQLEOF
SUDO docker cp /tmp/audit.sql "$DB":/tmp/audit.sql >/dev/null
SUDO docker exec "$DB" psql -U postgres -d postgres -t -A -F $'\\t' -f /tmp/audit.sql
""" % (SID, sp, sql)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
stdin, stdout, stderr = cli.exec_command("bash -s", timeout=60)
stdin.write(script); stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
cli.close()
if err.strip() and not out.strip():
    print(err, file=sys.stderr); sys.exit(1)

any_drift = False
print("Permission drift audit -- base role vs. each organization's own override\n")
for line in out.strip().splitlines():
    if not line.strip():
        continue
    parts = line.split("\t")
    if len(parts) < 3:
        continue
    slug, name, perms_raw = parts[0], parts[1], "\t".join(parts[2:])
    try:
        perms = json.loads(perms_raw)
    except json.JSONDecodeError:
        perms = {}
    if not perms:
        continue
    for role, override in perms.items():
        if role not in base:
            print(f"  ?  {name} ({slug}) / {role}: overridden but this role no longer exists in the shared PERMISSIONS table at all")
            any_drift = True
            continue
        base_can = set(base[role].get("can", []))
        base_nav = set(base[role].get("nav", []))
        ov_can = set((override or {}).get("can", {}).keys()) if isinstance((override or {}).get("can"), dict) else None
        ov_nav = set((override or {}).get("nav", [])) if isinstance((override or {}).get("nav"), list) else None
        if ov_can is not None and "all" not in ov_can:
            missing_can = base_can - ov_can
            if missing_can:
                print(f"  !  {name} ({slug}) / {role}: override's 'can' is missing {sorted(missing_can)} (present in the base role, absent here)")
                any_drift = True
        if ov_nav is not None:
            missing_nav = base_nav - ov_nav
            if missing_nav:
                print(f"  !  {name} ({slug}) / {role}: override's 'nav' is missing {sorted(missing_nav)} (present in the base role, absent here)")
                any_drift = True

if not any_drift:
    print("  ok  no override is missing anything the base role currently has")
print("\nA finding here is not automatically wrong -- it may be a deliberate restriction.")
print("Review each one and decide whether the organization's override needs updating.")
