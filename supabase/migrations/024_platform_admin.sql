-- ============================================================================
-- OP Central — 024: Platform (master-admin) console backend
-- ============================================================================
-- Everything the developer/master console needs, as SECURITY DEFINER RPCs that
-- authorise on is_master_admin() ONLY.
--
-- Why separate RPCs: since 022, is_org_admin() is scoped to the caller's ACTIVE
-- org, so a master admin sitting in org A could not administer org B. These
-- RPCs deliberately work across every org — that is what platform admin means —
-- while normal tenant users keep hitting the ordinary org-scoped path.
--
-- Adds to organizations: plan + billing_status (+ constraints), and makes
-- suspended/cancelled orgs actually lose access.
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- 1. Plan + billing on the tenant record
-- ============================================================================
alter table public.organizations add column if not exists plan            text not null default 'free-trial';
alter table public.organizations add column if not exists billing_status  text not null default 'active';
alter table public.organizations add column if not exists plan_started_at timestamptz;
alter table public.organizations add column if not exists notes           text;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname='organizations_plan_chk') then
    alter table public.organizations add constraint organizations_plan_chk
      check (plan in ('free-trial','starter','pro'));
  end if;
  if not exists (select 1 from pg_constraint where conname='organizations_billing_chk') then
    alter table public.organizations add constraint organizations_billing_chk
      check (billing_status in ('active','pending','overdue','suspended','cancelled'));
  end if;
end $c$;

-- ============================================================================
-- 2. Suspended / cancelled tenants lose access.
--    'pending' and 'overdue' still work — you chase payment, you don't cut
--    people off by accident. Only an explicit suspend/cancel locks the door.
-- ============================================================================
create or replace function public.org_is_serviceable(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org_id
      and o.status = 'active'
      and o.billing_status not in ('suspended','cancelled')
  );
$fn$;
grant execute on function public.org_is_serviceable(uuid) to authenticated;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_org_id is not null
     and p_org_id = public.active_org_id()
     and public.org_is_serviceable(p_org_id)
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

-- ============================================================================
-- 3. Master console — read everything in ONE round trip (the host is small;
--    one call keeps load down and the UI simple).
-- ============================================================================
create or replace function public.opc_admin_list_organizations()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select case when not public.is_master_admin() then '[]'::jsonb else coalesce(
    (select jsonb_agg(row order by row->>'name')
     from (
       select jsonb_build_object(
         'id', o.id,
         'name', o.name,
         'slug', o.slug,
         'subdomain', o.subdomain,
         'status', o.status,
         'plan', o.plan,
         'billing_status', o.billing_status,
         'plan_started_at', o.plan_started_at,
         'notes', o.notes,
         'created_at', o.created_at,
         'features', coalesce((select jsonb_object_agg(f.feature_key, f.enabled)
                               from public.organization_features f
                               where f.organization_id = o.id), '{}'::jsonb),
         'members', (select count(*) from public.organization_memberships m
                      where m.organization_id = o.id and m.is_active),
         'sales_orders', (select count(*) from public.sales_orders s where s.organization_id = o.id),
         'settings', coalesce((select to_jsonb(st) - 'organization_id'
                               from public.organization_settings st
                               where st.organization_id = o.id), '{}'::jsonb)
       ) as row
       from public.organizations o
     ) t), '[]'::jsonb) end;
$fn$;
grant execute on function public.opc_admin_list_organizations() to authenticated;

-- ============================================================================
-- 4. Master console — mutations (all master-admin only, all validated)
-- ============================================================================

-- 4a. Feature toggle for ANY org (checkbox in the console).
create or replace function public.opc_admin_set_feature(p_org_id uuid, p_key text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if coalesce(trim(p_key),'') = '' then raise exception 'feature_key is required'; end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'No such organization';
  end if;
  insert into public.organization_features (organization_id, feature_key, enabled, updated_at, updated_by)
  values (p_org_id, trim(p_key), coalesce(p_enabled,false), now(), auth.uid()::text)
  on conflict (organization_id, feature_key)
  do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;
  return coalesce((select jsonb_object_agg(f.feature_key, f.enabled)
                   from public.organization_features f where f.organization_id = p_org_id), '{}'::jsonb);
end $fn$;
grant execute on function public.opc_admin_set_feature(uuid, text, boolean) to authenticated;

-- 4b. Assign / clear a tenant subdomain (no Vercel step needed once the
--     wildcard domain exists — this row IS the routing config).
create or replace function public.opc_admin_set_subdomain(p_org_id uuid, p_subdomain text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_sub text := nullif(lower(trim(coalesce(p_subdomain,''))), '');
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'No such organization';
  end if;
  if v_sub is not null then
    if v_sub !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
      raise exception 'Subdomain must be 2-63 chars: lowercase letters, digits, hyphens, starting alphanumeric';
    end if;
    if exists (select 1 from public.reserved_subdomains r where r.label = v_sub) then
      raise exception 'Subdomain "%" is reserved by the platform', v_sub;
    end if;
    if exists (select 1 from public.organizations o
               where o.id <> p_org_id and o.subdomain is not null
                 and lower(trim(o.subdomain)) = v_sub) then
      raise exception 'Subdomain "%" is already taken', v_sub;
    end if;
  end if;
  update public.organizations set subdomain = v_sub, updated_at = now() where id = p_org_id;
  return (select jsonb_build_object('id', id, 'subdomain', subdomain)
          from public.organizations where id = p_org_id);
end $fn$;
grant execute on function public.opc_admin_set_subdomain(uuid, text) to authenticated;

-- 4c. Plan + billing state.
create or replace function public.opc_admin_set_billing(p_org_id uuid, p_plan text, p_billing_status text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if p_plan is not null and p_plan not in ('free-trial','starter','pro') then
    raise exception 'plan must be free-trial | starter | pro';
  end if;
  if p_billing_status is not null and p_billing_status not in
     ('active','pending','overdue','suspended','cancelled') then
    raise exception 'billing_status must be active | pending | overdue | suspended | cancelled';
  end if;
  update public.organizations
     set plan            = coalesce(p_plan, plan),
         billing_status  = coalesce(p_billing_status, billing_status),
         plan_started_at = case when p_plan is not null and p_plan <> plan then now() else plan_started_at end,
         updated_at      = now()
   where id = p_org_id;
  return (select jsonb_build_object('id',id,'plan',plan,'billing_status',billing_status)
          from public.organizations where id = p_org_id);
end $fn$;
grant execute on function public.opc_admin_set_billing(uuid, text, text) to authenticated;

-- 4d. Rename / set status / notes.
create or replace function public.opc_admin_update_org(p_org_id uuid, p_name text, p_status text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if p_status is not null and p_status not in ('active','suspended') then
    raise exception 'status must be active | suspended';
  end if;
  update public.organizations
     set name   = coalesce(nullif(trim(p_name),''), name),
         status = coalesce(p_status, status),
         notes  = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_org_id;
  return (select to_jsonb(o) from public.organizations o where o.id = p_org_id);
end $fn$;
grant execute on function public.opc_admin_update_org(uuid, text, text, text) to authenticated;

-- 4e. Create a whole organization from the console, with the feature set chosen
--     up front. Writes EXPLICIT rows for every key passed, so "not ticked" means
--     a real `false` row — never an ambiguous missing one.
create or replace function public.opc_admin_create_org(
  p_name       text,
  p_slug       text,
  p_subdomain  text default null,
  p_plan       text default 'free-trial',
  p_features   jsonb default '{}'::jsonb,
  p_admin_user_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_slug text := lower(trim(coalesce(p_slug,''))); k text;
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Organization name is required'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'Slug must be 2-63 chars: lowercase letters, digits, hyphens, starting alphanumeric';
  end if;
  if exists (select 1 from public.organizations where slug = v_slug) then
    raise exception 'Slug "%" is already taken', v_slug;
  end if;
  if p_plan is not null and p_plan not in ('free-trial','starter','pro') then
    raise exception 'plan must be free-trial | starter | pro';
  end if;

  insert into public.organizations (name, slug, plan, plan_started_at)
  values (trim(p_name), v_slug, coalesce(p_plan,'free-trial'), now())
  returning id into v_id;

  -- subdomain goes through the same validation as the console's inline edit
  if nullif(trim(coalesce(p_subdomain,'')),'') is not null then
    perform public.opc_admin_set_subdomain(v_id, p_subdomain);
  end if;

  insert into public.organization_settings (organization_id) values (v_id)
  on conflict (organization_id) do nothing;

  if p_features is not null and jsonb_typeof(p_features) = 'object' then
    for k in select jsonb_object_keys(p_features) loop
      insert into public.organization_features (organization_id, feature_key, enabled, updated_by)
      values (v_id, k, coalesce((p_features->>k)::boolean, false), auth.uid()::text)
      on conflict (organization_id, feature_key) do update set enabled = excluded.enabled;
    end loop;
  end if;

  if p_admin_user_id is not null then
    if not exists (select 1 from public.users u where u.id = p_admin_user_id) then
      raise exception 'No user profile "%" — create the login first, then assign it', p_admin_user_id;
    end if;
    insert into public.organization_memberships (organization_id, user_id, role, is_active)
    values (v_id, p_admin_user_id, 'admin', true)
    on conflict (organization_id, user_id) do update set role='admin', is_active=true;
  end if;

  return (select jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'subdomain',o.subdomain)
          from public.organizations o where o.id = v_id);
end $fn$;
grant execute on function public.opc_admin_create_org(text, text, text, text, jsonb, text) to authenticated;

-- 4f. Per-org permissions / workflow / structure. This writes the SAME config
--     blob the tenant app reads (config.data), but for ANY org — so the platform
--     admin can shape a tenant's roles and workflow stages without switching in.
create or replace function public.opc_admin_get_org_config(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select case when not public.is_master_admin() then '{}'::jsonb
         else coalesce((select c.data from public.config c
                        where c.organization_id = p_org_id limit 1), '{}'::jsonb) end;
$fn$;
grant execute on function public.opc_admin_get_org_config(uuid) to authenticated;

create or replace function public.opc_admin_set_org_config(p_org_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id text;
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'No such organization';
  end if;
  select c.id into v_id from public.config c where c.organization_id = p_org_id limit 1;
  if v_id is null then
    if not exists (select 1 from public.config where id = 'singleton') then v_id := 'singleton';
    else v_id := p_org_id::text; end if;
    insert into public.config (id, data, organization_id, updated_at)
    values (v_id, coalesce(p_data,'{}'::jsonb), p_org_id, now());
  else
    update public.config set data = coalesce(p_data,'{}'::jsonb), updated_at = now() where id = v_id;
  end if;
  return (select c.data from public.config c where c.id = v_id);
end $fn$;
grant execute on function public.opc_admin_set_org_config(uuid, jsonb) to authenticated;

-- 4g. Members of any org (so the console can assign the first admin).
create or replace function public.opc_admin_org_members(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select case when not public.is_master_admin() then '[]'::jsonb else coalesce(
    (select jsonb_agg(jsonb_build_object(
       'user_id', m.user_id, 'role', m.role, 'is_active', m.is_active,
       'name', u.name, 'email', u.email, 'app_role', u.role))
     from public.organization_memberships m
     left join public.users u on u.id = m.user_id
     where m.organization_id = p_org_id), '[]'::jsonb) end;
$fn$;
grant execute on function public.opc_admin_org_members(uuid) to authenticated;

notify pgrst, 'reload schema';
