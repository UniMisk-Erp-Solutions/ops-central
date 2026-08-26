-- ============================================================================
-- OP Central — 021: PHASE 3 — tenant isolation ENFORCED  ⚠️ BEHAVIOURAL CHANGE
-- ============================================================================
-- This is the migration that actually turns on data isolation:
--
--   1. opc_create_user now also grants the new user a membership in the
--      creator's org (without this a new user would belong to NO org and see
--      nothing at all).
--   2. organization_id becomes NOT NULL on every tenant table.
--   3. member_all_*  ->  tenant_all_*  : a row is visible only to members of
--      its organization (is_org_member joins organization_memberships against
--      auth.uid(); the hostname is never consulted).
--   4. config and users become org-scoped too.
--
-- PRECONDITIONS (verified by scripts/ssh-apply-tenancy.py before running):
--   * 0 rows with organization_id IS NULL in every tenant table
--   * the edge function stamps organization_id on the rfqs rows it inserts
--   * frontend reads/writes config through opc_get_config / opc_save_config
--
-- ROLLBACK: supabase/migrations/021_phase3_tenant_rls_ROLLBACK.sql
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- 1. New users must land in the creator's organization.
-- ============================================================================
create or replace function public.opc_create_user(p_name text, p_email text, p_password text, p_role text)
returns table(id text, email text, name text, role text, initials text, active boolean)
language plpgsql security definer set search_path = public as $fn$
declare v uuid; v_ini text; v_org uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can create users'; end if;
  if coalesce(p_email,'') = '' or coalesce(p_password,'') = '' then raise exception 'Email and password are required'; end if;
  if exists(select 1 from auth.users a where lower(a.email) = lower(p_email)) then
    raise exception 'Email already in use';
  end if;

  v_org := public.default_org_id();          -- the CREATOR's org, server-derived
  if v_org is null then
    raise exception 'Your account is not linked to an organization yet';
  end if;

  v := public._opc_make_auth_user(p_email, p_password);
  v_ini := upper(substr(regexp_replace(coalesce(p_name, 'U'), '\s', '', 'g'), 1, 2));
  insert into public.users(id, email, name, role, initials, active)
    values (v::text, lower(p_email), p_name, coalesce(p_role, 'Sales'), v_ini, true);

  insert into public.organization_memberships (organization_id, user_id, role, is_active)
  values (v_org, v::text,
          case when coalesce(p_role,'') = 'Org Admin' then 'admin' else 'member' end,
          true)
  on conflict (organization_id, user_id) do update set is_active = true;

  return query select u.id, u.email, u.name, u.role, u.initials, u.active
               from public.users u where u.id = v::text;
end $fn$;
grant execute on function public.opc_create_user(text, text, text, text) to authenticated;

-- Signup of the very first admin also seeds org + membership when none exists,
-- so a fresh install is never left orgless.
create or replace function public.opc_bootstrap_org_for(p_user_id text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_org uuid;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    insert into public.organizations (name, slug, subdomain)
    values ('My Organization', 'org-' || substr(md5(random()::text), 1, 8), null)
    returning id into v_org;
    insert into public.organization_settings (organization_id) values (v_org)
    on conflict (organization_id) do nothing;
  end if;
  insert into public.organization_memberships (organization_id, user_id, role, is_active)
  values (v_org, p_user_id, 'admin', true)
  on conflict (organization_id, user_id) do update set role = 'admin', is_active = true;
  insert into public.master_admin_memberships (user_id, granted_by)
  values (p_user_id, 'bootstrap') on conflict (user_id) do nothing;
  return v_org;
end $fn$;
revoke all on function public.opc_bootstrap_org_for(text) from public, anon, authenticated;

-- ============================================================================
-- 2 + 3. NOT NULL, then swap the tenant-blind policies for tenant-scoped ones.
-- ============================================================================
do $mig$
declare
  t text;
  n bigint;
  scoped text[] := array[
    'sales_orders','vendor_pos','grns','vendor_invoices','payments',
    'sourcings','rfqs','transfer_requests','pool',
    'customers','vendors','notifications','audit',
    'products','categories','boms'
  ];
begin
  foreach t in array scoped loop
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=t and column_name='organization_id') then
      raise notice 'skipping % (no organization_id)', t;
      continue;
    end if;

    -- Refuse to enforce while any row would become orphaned/invisible.
    execute format('select count(*) from public.%I where organization_id is null', t) into n;
    if n > 0 then
      raise exception 'ABORT: %.organization_id has % null row(s) — backfill before enforcing', t, n;
    end if;

    execute format('alter table public.%I alter column organization_id set not null', t);

    execute format('drop policy if exists %I on public.%I;', 'member_all_' || t, t);
    execute format('drop policy if exists %I on public.%I;', 'tenant_all_' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.is_org_member(organization_id)) '
      || 'with check (public.is_org_member(organization_id));',
      'tenant_all_' || t, t);
  end loop;
end $mig$;

-- ============================================================================
-- 4a. config — one row per org; read = member, write = admin of THAT org.
--     (The app now goes through opc_get_config / opc_save_config, which are
--      SECURITY DEFINER; these policies cover any direct access.)
-- ============================================================================
drop policy if exists config_read  on public.config;
drop policy if exists config_write on public.config;
create policy config_read on public.config for select to authenticated
  using (organization_id is not null and public.is_org_member(organization_id));
create policy config_write on public.config for all to authenticated
  using (organization_id is not null and public.is_org_admin(organization_id))
  with check (organization_id is not null and public.is_org_admin(organization_id));

-- ============================================================================
-- 4b. users — you may see profiles of people you share an organization with.
--     A user always sees themselves; master admins see everyone.
-- ============================================================================
drop policy if exists users_read  on public.users;
drop policy if exists users_write on public.users;
create policy users_read on public.users for select to authenticated
  using (public.shares_org_with(id));
create policy users_write on public.users for all to authenticated
  using (public.is_master_admin() or (public.is_admin() and public.shares_org_with(id)))
  with check (public.is_master_admin() or (public.is_admin() and public.shares_org_with(id)));

notify pgrst, 'reload schema';
