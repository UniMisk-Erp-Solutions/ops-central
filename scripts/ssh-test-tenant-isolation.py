#!/usr/bin/env python3
"""End-to-end multi-tenant isolation test on the SO-PO DB.

Creates a THROWAWAY second organization + user, gives it one sales order, then
proves both directions of isolation:

  * tenant B's user sees ONLY tenant B's row (never the live tenant's data)
  * the live tenant's plain (non-master) user never sees tenant B's row
  * the subdomain uniqueness index rejects a duplicate/reserved subdomain

Always cleans up (deletes the test org; FK cascade removes its rows). The live
organization's data is never modified.
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
\echo '=== setup: throwaway tenant B ==='
do $$
declare v_org uuid; v_live uuid;
begin
  select id into v_live from organizations where slug='unimisk';

  delete from organizations where slug='zzz-testco';        -- clean slate
  insert into organizations (name, slug, subdomain) values ('ZZZ Test Co','zzz-testco','zzztestco')
  returning id into v_org;
  insert into organization_settings (organization_id) values (v_org) on conflict do nothing;

  -- a user that belongs ONLY to tenant B
  insert into users (id, email, name, role, initials, active)
  values ('00000000-0000-0000-0000-00000000beef','zzz@test.local','ZZZ Tester','Sales','ZT',true)
  on conflict (id) do nothing;
  insert into organization_memberships (organization_id, user_id, role, is_active)
  values (v_org,'00000000-0000-0000-0000-00000000beef','admin',true)
  on conflict (organization_id, user_id) do update set is_active=true;

  -- one sales order owned by tenant B
  insert into sales_orders (id, so_no, organization_id)
  values ('zzz-so-testco','SO/ZZZ/0001', v_org)
  on conflict (id) do update set organization_id = excluded.organization_id;

  -- a plain (non-master) user in the LIVE org, to test the other direction
  insert into users (id, email, name, role, initials, active)
  values ('00000000-0000-0000-0000-00000000cafe','plain@live.local','Plain Live','Sales','PL',true)
  on conflict (id) do nothing;
  insert into organization_memberships (organization_id, user_id, role, is_active)
  values (v_live,'00000000-0000-0000-0000-00000000cafe','member',true)
  on conflict (organization_id, user_id) do update set is_active=true;
end $$;

\echo ''
\echo '=== A) tenant B user: must see ONLY its own 1 SO ==='
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000beef","role":"authenticated"}';
  select count(*) as total_visible, count(*) filter (where id='zzz-so-testco') as own_row from sales_orders;
commit;

\echo ''
\echo '=== B) live-org plain user: must NOT see tenant B''s SO ==='
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cafe","role":"authenticated"}';
  select count(*) as total_visible, count(*) filter (where id='zzz-so-testco') as leaked_rows from sales_orders;
commit;

\echo ''
\echo '=== C) subdomain collision must be rejected ==='
do $$
begin
  begin
    insert into organizations (name, slug, subdomain) values ('Dup','zzz-dup','ZZZTestCo');
    raise warning 'FAIL: duplicate subdomain was accepted';
  exception when unique_violation then
    raise notice 'PASS: duplicate subdomain rejected (case-insensitive)';
  end;
end $$;

\echo ''
\echo '=== CLEANUP ==='
delete from organizations where slug in ('zzz-testco','zzz-dup');
delete from organization_memberships where user_id in ('00000000-0000-0000-0000-00000000beef','00000000-0000-0000-0000-00000000cafe');
delete from users where id in ('00000000-0000-0000-0000-00000000beef','00000000-0000-0000-0000-00000000cafe');
select 'leftover test orgs' as what, count(*) from organizations where slug like 'zzz-%'
union all select 'leftover test SOs', count(*) from sales_orders where id like 'zzz-%'
union all select 'live sales_orders (must still be 39)', count(*) from sales_orders;
"""

sp = PW.replace("'", "'\"'\"'")
script = """#!/bin/bash
SUDO(){ echo '%s' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-%s" | head -1)
cat > /tmp/isotest.sql <<'SQLEOF'
%s
SQLEOF
SUDO docker cp /tmp/isotest.sql "$DB":/tmp/isotest.sql >/dev/null
SUDO docker exec "$DB" psql -U postgres -d postgres -f /tmp/isotest.sql
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
