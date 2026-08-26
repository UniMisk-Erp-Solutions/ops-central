-- ============================================================================
-- OP Central — 022: active-org scoping + per-org feature flags (PHASE 4)
-- ============================================================================
-- Two changes:
--
-- (A) ACTIVE ORGANIZATION.  Previously a platform super-admin matched
--     is_org_member() for EVERY org, so once a second tenant existed their app
--     would load every tenant's rows into one list (data soup), and new rows
--     could be stamped with the wrong org. Now every user — including master
--     admins — works inside ONE active organization at a time, and switches
--     explicitly via opc_set_active_org().
--
--     Default active org = the user's primary membership, so behaviour for
--     everyone today is EXACTLY unchanged.
--
-- (B) FEATURE FLAGS.  Seeds explicit rows for the existing org so it is
--     "managed", and adds opc_my_features() for the app to read.
--
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- A1. Which org is the caller currently working in?
-- ============================================================================
create table if not exists public.user_active_org (
  user_id         text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  set_at          timestamptz not null default now()
);
alter table public.user_active_org enable row level security;
revoke all on public.user_active_org from anon;
grant select on public.user_active_org to authenticated;
drop policy if exists active_org_self on public.user_active_org;
create policy active_org_self on public.user_active_org for select to authenticated
  using (user_id = auth.uid()::text);

create or replace function public.active_org_id()
returns uuid language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select a.organization_id from public.user_active_org a where a.user_id = auth.uid()::text),
    public.default_org_id()
  );
$fn$;
grant execute on function public.active_org_id() to authenticated;

-- Switch org. Allowed only for an org you belong to (master admins may switch
-- to any org — that is what platform administration means).
create or replace function public.opc_set_active_org(p_org_id uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
begin
  if p_org_id is null then
    delete from public.user_active_org where user_id = auth.uid()::text;
    return public.default_org_id();
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'No such organization';
  end if;
  if not public.is_master_admin()
     and not exists (select 1 from public.organization_memberships om
                     where om.user_id = auth.uid()::text
                       and om.organization_id = p_org_id and om.is_active) then
    raise exception 'You are not a member of that organization';
  end if;
  insert into public.user_active_org (user_id, organization_id, set_at)
  values (auth.uid()::text, p_org_id, now())
  on conflict (user_id) do update set organization_id = excluded.organization_id, set_at = now();
  return p_org_id;
end $fn$;
grant execute on function public.opc_set_active_org(uuid) to authenticated;

-- ============================================================================
-- A2. Scope membership checks to the ACTIVE org.
--     A master admin no longer matches every org at once — they match the one
--     they are currently working in.
-- ============================================================================
create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_org_id is not null
     and p_org_id = public.active_org_id()
     and (
       public.is_master_admin()
       or exists (
         select 1 from public.organization_memberships om
         where om.user_id = auth.uid()::text
           and om.organization_id = p_org_id
           and om.is_active = true
       )
     );
$fn$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_org_id is not null
     and p_org_id = public.active_org_id()
     and (
       public.is_master_admin()
       or exists (
         select 1 from public.organization_memberships om
         where om.user_id = auth.uid()::text
           and om.organization_id = p_org_id
           and om.role = 'admin'
           and om.is_active = true
       )
     );
$fn$;

-- A platform admin must still be able to LIST every org (to switch into one).
drop policy if exists orgs_read on public.organizations;
create policy orgs_read on public.organizations for select to authenticated
  using (public.is_master_admin() or public.is_org_member(id));

-- ============================================================================
-- A3. New rows are stamped with the ACTIVE org (not merely the primary one),
--     so work done while switched into a tenant belongs to that tenant.
--     Still 100% server-derived from auth.uid() — never client input.
-- ============================================================================
do $defs$
declare
  t text;
  tbls text[] := array[
    'sales_orders','vendor_pos','grns','vendor_invoices','payments',
    'sourcings','rfqs','transfer_requests','pool',
    'customers','vendors','notifications','audit',
    'products','categories','boms','config'
  ];
begin
  foreach t in array tbls loop
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name=t and column_name='organization_id') then
      execute format('alter table public.%I alter column organization_id set default public.active_org_id()', t);
    end if;
  end loop;
end $defs$;

-- config helpers must follow the active org too.
create or replace function public.opc_get_config()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select c.data from public.config c where c.organization_id = public.active_org_id() limit 1),
    '{}'::jsonb);
$fn$;

create or replace function public.opc_save_config(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.active_org_id(); v_id text;
begin
  if v_org is null then raise exception 'You do not belong to an organization'; end if;
  if not public.is_org_member(v_org) then raise exception 'Not a member of this organization'; end if;
  select c.id into v_id from public.config c where c.organization_id = v_org limit 1;
  if v_id is null then
    if not exists (select 1 from public.config c where c.id = 'singleton') then v_id := 'singleton';
    else v_id := v_org::text; end if;
    insert into public.config (id, data, organization_id, updated_at)
    values (v_id, coalesce(p_data, '{}'::jsonb), v_org, now());
  else
    update public.config set data = coalesce(p_data, '{}'::jsonb), updated_at = now() where id = v_id;
  end if;
  return (select c.data from public.config c where c.id = v_id);
end $fn$;

-- ============================================================================
-- B. Feature flags for the app.
-- ============================================================================
-- Features of the caller's ACTIVE org, as { key: bool }.
create or replace function public.opc_my_features()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select jsonb_object_agg(f.feature_key, coalesce(f.enabled, false))
     from public.organization_features f
     where f.organization_id = public.active_org_id()),
    '{}'::jsonb);
$fn$;
grant execute on function public.opc_my_features() to authenticated;

-- Who am I / where am I? One call for the app to bootstrap tenant context.
create or replace function public.opc_my_context()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'active_org_id', public.active_org_id(),
    'is_master_admin', public.is_master_admin(),
    'organization', (select to_jsonb(o) - 'created_at' - 'updated_at'
                     from public.organizations o where o.id = public.active_org_id()),
    'features', public.opc_my_features()
  );
$fn$;
grant execute on function public.opc_my_context() to authenticated;

-- Seed EXPLICIT feature rows for the existing organization so it is "managed"
-- and nothing it does today can silently disappear. New orgs are still seeded
-- with nothing (see opc_create_organization) so they start minimal.
do $seed$
declare v_org uuid; k text;
  keys text[] := array['presales','sales_desk','stores','cross_so_transfer','surplus_pool',
                       'partial_invoicing','implementation','rfq_email','e_invoice',
                       'e_way_bill','whatsapp','sms'];
begin
  select id into v_org from public.organizations where slug = 'unimisk';
  if v_org is null then return; end if;
  foreach k in array keys loop
    insert into public.organization_features (organization_id, feature_key, enabled, updated_by)
    values (v_org, k, true, 'migration-022')
    on conflict (organization_id, feature_key) do nothing;
  end loop;
end $seed$;

notify pgrst, 'reload schema';
