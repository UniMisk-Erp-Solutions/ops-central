#!/usr/bin/env python3
"""Provision a whole tenant: login, organization, membership, features, profile.

A new company is an INSERT, not a release. This is the one script that does it,
parameterised, so the next company is another run of it rather than another
script — and so the steps are on the record rather than in somebody's terminal
history.

Everything runs in ONE transaction and every step is idempotent, so a re-run
after a half-finished attempt repairs rather than duplicates. It prints every
organization's row counts before and after, because the thing most worth proving
about a new tenant is that the existing ones did not move.

  SSH_PASSWORD='...' python scripts/ssh-provision-tenant.py \
      --name "Demo Org" --slug demo --subdomain dm \
      --admin-email admin@demo.com --admin-password 'qwertyui' \
      --admin-name "Demo Admin" --profile split_stores

  --dry-run   roll the transaction back at the end and show what it would do

The auth user is created in SQL with pgcrypto's bcrypt, which is what GoTrue
stores; the matching auth.identities row is created too, because email sign-in
looks the user up through it and a user without one cannot log in.
"""
import argparse, base64, os, sys
import paramiko

AP = argparse.ArgumentParser()
AP.add_argument("--name", required=True, help="display name of the company")
AP.add_argument("--slug", required=True, help="unique short key, lowercase")
AP.add_argument("--subdomain", default=None, help="label under the base domain, or omit for the shared host")
AP.add_argument("--admin-email", required=True)
AP.add_argument("--admin-password", required=True)
AP.add_argument("--admin-name", default=None)
AP.add_argument("--profile", default="standard", help="workflow_profiles.id this org runs")
AP.add_argument("--fiscal-year", default="FY26")
AP.add_argument("--features-on", default="", help="comma separated feature keys to switch ON")
AP.add_argument("--features-off", default="", help="comma separated feature keys to switch OFF")
AP.add_argument("--dry-run", action="store_true")
A = AP.parse_args()

PW = os.environ.get("SSH_PASSWORD", "")
HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
SID = os.environ.get("SUPABASE_SERVICE_ID", "spfohj2m4ij61p4riaup006i")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)


def lit(v):
    """A SQL string literal, or NULL."""
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def keys(csv):
    return [k.strip() for k in csv.split(",") if k.strip()]


on_rows = ",\n      ".join(f"({lit(k)}, true)" for k in keys(A.features_on)) or None
off_rows = ",\n      ".join(f"({lit(k)}, false)" for k in keys(A.features_off)) or None
feature_values = ",\n      ".join(x for x in [on_rows, off_rows] if x)

SQL = f"""
\\set ON_ERROR_STOP on
begin;

\\echo ''
\\echo '=== BEFORE — every organization, and what it holds ==='
select o.name, coalesce(o.subdomain,'-') sub, o.workflow_profile,
       (select count(*) from sales_orders x where x.organization_id=o.id) so,
       (select count(*) from vendor_pos   x where x.organization_id=o.id) po,
       (select count(*) from products     x where x.organization_id=o.id) prod,
       (select count(*) from customers    x where x.organization_id=o.id) cust
  from organizations o order by o.created_at;

do $prov$
declare
  v_uid   uuid;
  v_org   uuid;
  v_email text := {lit(A.admin_email)};
  v_name  text := {lit(A.admin_name or A.name + ' Admin')};
begin
  -- 1. The login. GoTrue stores bcrypt, which is what pgcrypto's bf salt makes.
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous,
      -- EMPTY STRINGS, NOT NULL. GoTrue reads these varchars into Go strings,
      -- and a NULL fails the scan — the sign-in then returns
      -- 500 'Database error querying schema', which says nothing about the
      -- real cause and sends you looking at the password. Supabase's own
      -- sign-up writes '' here; a hand-made row has to as well.
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token)
    values (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      lower(v_email), crypt({lit(A.admin_password)}, gen_salt('bf')),
      now(), '{{"provider":"email","providers":["email"]}}'::jsonb, '{{}}'::jsonb,
      now(), now(), false, false,
      '', '', '', '', '', '', '', '');
    raise notice 'created auth user % (%)', v_email, v_uid;
  else
    -- A re-run resets the password rather than leaving an unknown one in place.
    update auth.users
       set encrypted_password = crypt({lit(A.admin_password)}, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now(),
           -- Repair a row made before this script knew about the NULL trap.
           confirmation_token         = coalesce(confirmation_token, ''),
           recovery_token             = coalesce(recovery_token, ''),
           email_change               = coalesce(email_change, ''),
           email_change_token_new     = coalesce(email_change_token_new, ''),
           email_change_token_current = coalesce(email_change_token_current, ''),
           phone_change               = coalesce(phone_change, ''),
           phone_change_token         = coalesce(phone_change_token, ''),
           reauthentication_token     = coalesce(reauthentication_token, '')
     where id = v_uid;
    raise notice 'auth user % already existed (%) — password reset', v_email, v_uid;
  end if;

  -- Email sign-in resolves the user THROUGH this row. Without it the password
  -- is correct and the login still fails, with nothing in the UI to say why.
  if not exists (select 1 from auth.identities
                  where user_id = v_uid and provider = 'email') then
    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data, created_at, updated_at)
    values (
      gen_random_uuid(), v_uid, v_uid::text, 'email',
      jsonb_build_object('sub', v_uid::text, 'email', lower(v_email),
                         'email_verified', true, 'phone_verified', false),
      now(), now());
  end if;

  -- 2. The app-side profile. Its id is the auth uuid as text.
  insert into public.users (id, email, name, role, initials, active)
  values (v_uid::text, lower(v_email), v_name, 'Org Admin',
          upper(left(regexp_replace(v_name, '[^A-Za-z ]', '', 'g'), 1))
          || upper(left(split_part(regexp_replace(v_name, '[^A-Za-z ]', '', 'g'), ' ', 2), 1)),
          true)
  on conflict (id) do update
     set email = excluded.email, name = excluded.name,
         role = 'Org Admin', active = true;

  -- 3. The organization.
  select id into v_org from organizations where slug = {lit(A.slug)};
  if v_org is null then
    insert into organizations (name, slug, subdomain, status, workflow_profile)
    values ({lit(A.name)}, {lit(A.slug)}, {lit(A.subdomain)}, 'active', {lit(A.profile)})
    returning id into v_org;
    raise notice 'created organization % (%)', {lit(A.name)}, v_org;
  else
    update organizations
       set name = {lit(A.name)}, subdomain = {lit(A.subdomain)},
           status = 'active', workflow_profile = {lit(A.profile)}
     where id = v_org;
    raise notice 'organization % already existed (%) — updated', {lit(A.slug)}, v_org;
  end if;

  -- 4. Membership. THIS is the security boundary — not the subdomain.
  insert into organization_memberships (organization_id, user_id, role, is_active)
  values (v_org, v_uid::text, 'admin', true)
  on conflict (organization_id, user_id) do update
     set role = 'admin', is_active = true;

  -- 5. Settings. Exactly one row per org; parameters, not capabilities.
  insert into organization_settings (organization_id, fiscal_year, data)
  values (v_org, {lit(A.fiscal_year)}, '{{}}'::jsonb)
  on conflict (organization_id) do update set fiscal_year = excluded.fiscal_year;

  -- 6. Capabilities. Written explicitly rather than left absent: 'no row' means
  --    inherited, and a tenant's capability set should be a thing you can read.
  {"insert into organization_features (organization_id, feature_key, enabled) select v_org, k, e from (values " + feature_values + ") as t(k, e) on conflict (organization_id, feature_key) do update set enabled = excluded.enabled;" if feature_values else "-- no feature rows requested"}

  perform set_config('opc.new_org', v_org::text, true);
end
$prov$;

\\echo ''
\\echo '=== the new organization ==='
select o.id, o.name, o.slug, coalesce(o.subdomain,'-') sub, o.status, o.workflow_profile
  from organizations o where o.slug = {lit(A.slug)};

\\echo ''
\\echo '=== its login ==='
select u.email, u.name, u.role, m.role as membership, m.is_active,
       (select count(*) from auth.identities i where i.user_id::text = u.id) as identities
  from public.users u
  join organization_memberships m on m.user_id = u.id
  join organizations o on o.id = m.organization_id
 where o.slug = {lit(A.slug)};

\\echo ''
\\echo '=== its capabilities ==='
select feature_key, enabled from organization_features
 where organization_id = current_setting('opc.new_org')::uuid order by feature_key;

\\echo ''
\\echo '=== AFTER — every organization, and what it holds ==='
select o.name, coalesce(o.subdomain,'-') sub, o.workflow_profile,
       (select count(*) from sales_orders x where x.organization_id=o.id) so,
       (select count(*) from vendor_pos   x where x.organization_id=o.id) po,
       (select count(*) from products     x where x.organization_id=o.id) prod,
       (select count(*) from customers    x where x.organization_id=o.id) cust,
       (select count(*) from users u join organization_memberships m
          on m.user_id = u.id and m.organization_id = o.id) usr
  from organizations o order by o.created_at;

\\echo ''
\\echo '=== the new tenant must be EMPTY ==='
select 'sales_orders' t, count(*) from sales_orders where organization_id = current_setting('opc.new_org')::uuid
union all select 'vendor_pos', count(*) from vendor_pos where organization_id = current_setting('opc.new_org')::uuid
union all select 'grns', count(*) from grns where organization_id = current_setting('opc.new_org')::uuid
union all select 'products', count(*) from products where organization_id = current_setting('opc.new_org')::uuid
union all select 'categories', count(*) from categories where organization_id = current_setting('opc.new_org')::uuid
union all select 'customers', count(*) from customers where organization_id = current_setting('opc.new_org')::uuid
union all select 'vendors', count(*) from vendors where organization_id = current_setting('opc.new_org')::uuid
union all select 'sourcings', count(*) from sourcings where organization_id = current_setting('opc.new_org')::uuid
union all select 'notifications', count(*) from notifications where organization_id = current_setting('opc.new_org')::uuid
union all select 'audit', count(*) from audit where organization_id = current_setting('opc.new_org')::uuid;

{"rollback;" if A.dry_run else "commit;"}
\\echo ''
\\echo '{"ROLLED BACK — dry run" if A.dry_run else "COMMITTED"}'
"""

b64 = base64.b64encode(SQL.encode("utf-8")).decode("ascii")
sp = PW.replace("'", "'\"'\"'")
shell = f"""
SUDO(){{ echo '{sp}' | sudo -S "$@"; }}
DB=$(SUDO docker ps --format '{{{{.Names}}}}' 2>/dev/null | grep "supabase-db-{SID}" | head -1)
if [ -z "$DB" ]; then echo '!! supabase db container not found for {SID}'; exit 1; fi
echo "database container: $DB"
echo '{b64}' | base64 -d > /tmp/opc_prov.sql
SUDO docker cp /tmp/opc_prov.sql "$DB":/tmp/opc_prov.sql >/dev/null 2>&1
SUDO docker exec "$DB" psql -U postgres -d postgres -f /tmp/opc_prov.sql
RC=$?
rm -f /tmp/opc_prov.sql
SUDO docker exec "$DB" rm -f /tmp/opc_prov.sql >/dev/null 2>&1
exit $RC
"""

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=45)
stdin, stdout, stderr = cli.exec_command("bash -s", timeout=900)
stdin.write(shell); stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", "replace")
rc = stdout.channel.recv_exit_status()
err = stderr.read().decode("utf-8", "replace")
err = "\n".join(l for l in err.splitlines() if "[sudo]" not in l).strip()
print(out)
if err:
    print("--- stderr ---\n" + err[:6000])
cli.close()
sys.exit(rc)
