#!/usr/bin/env python3
"""Create (or repair) a PLATFORM master-admin login.

Idempotent: if the email already exists it resets the password and makes sure the
account is a platform admin — it never creates a duplicate and never touches data.

Usage:
  SSH_PASSWORD=... MA_EMAIL=info@unimisk.com MA_PASSWORD=... MA_NAME='Unimisk Admin' \
    python scripts/ssh-create-master-admin.py
"""
import os, sys
import paramiko

PW = os.environ.get("SSH_PASSWORD", "")
HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
EMAIL = os.environ.get("MA_EMAIL", "").strip().lower()
PASSWORD = os.environ.get("MA_PASSWORD", "")
NAME = os.environ.get("MA_NAME", "Platform Admin")
if not PW or not EMAIL or not PASSWORD:
    print("Set SSH_PASSWORD, MA_EMAIL, MA_PASSWORD", file=sys.stderr); sys.exit(1)
if len(PASSWORD) < 8:
    print("Password must be at least 8 characters", file=sys.stderr); sys.exit(2)

SQL = r"""
\set ON_ERROR_STOP on
do $$
declare
  v_email text := lower(trim('__EMAIL__'));
  v_pass  text := '__PASS__';
  v_name  text := '__NAME__';
  v_id    uuid;
  v_org   uuid;
  v_new   boolean := false;
begin
  select id into v_id from auth.users where lower(email) = v_email;

  if v_id is null then
    v_id := public._opc_make_auth_user(v_email, v_pass);
    v_new := true;
    raise notice 'created new auth user %', v_id;
  else
    -- existing login: reset the password, keep the SAME id so all data stays put
    update auth.users
       set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           recovery_token = '', email_change = '', email_change_token_new = '',
           updated_at = now()
     where id = v_id;
    raise notice 'reset password for existing user %', v_id;
  end if;

  -- profile
  insert into public.users (id, email, name, role, initials, active)
  values (v_id::text, v_email, v_name, 'Org Admin',
          upper(substr(regexp_replace(v_name, '\s', '', 'g'), 1, 2)), true)
  on conflict (id) do update
    set email = excluded.email, role = 'Org Admin', active = true;

  -- keep a membership so the account also works as a normal tenant user
  select id into v_org from public.organizations where slug = 'unimisk';
  if v_org is null then select id into v_org from public.organizations order by created_at limit 1; end if;
  if v_org is not null then
    insert into public.organization_memberships (organization_id, user_id, role, is_active)
    values (v_org, v_id::text, 'admin', true)
    on conflict (organization_id, user_id) do update set role = 'admin', is_active = true;
  end if;

  -- THE platform-admin grant
  insert into public.master_admin_memberships (user_id, granted_by)
  values (v_id::text, 'ssh-create-master-admin')
  on conflict (user_id) do nothing;

  raise notice 'master admin ready: % (new=%)', v_email, v_new;
end $$;

select u.email, u.name, u.role, u.active,
       (select count(*) from public.master_admin_memberships m where m.user_id = u.id) as is_master,
       (select count(*) from public.organization_memberships om where om.user_id = u.id and om.is_active) as memberships
from public.users u where lower(u.email) = lower('__EMAIL__');
"""
SQL = SQL.replace("__EMAIL__", EMAIL).replace("__PASS__", PASSWORD.replace("'", "''")).replace("__NAME__", NAME.replace("'", "''"))

sp = PW.replace("'", "'\"'\"'")
script = """SUDO(){ echo '%s' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-%s" | head -1)
cat > /tmp/ma.sql <<'SQLEOF'
%s
SQLEOF
SUDO docker cp /tmp/ma.sql "$DB":/tmp/ma.sql >/dev/null
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/ma.sql
SUDO docker exec "$DB" rm -f /tmp/ma.sql
rm -f /tmp/ma.sql
""" % (sp, SID, SQL)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
i, o, e = cli.exec_command("bash -s", timeout=120)
i.write(script); i.channel.shutdown_write()
out = o.read().decode("utf-8", "replace") + e.read().decode("utf-8", "replace")
cli.close()
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
