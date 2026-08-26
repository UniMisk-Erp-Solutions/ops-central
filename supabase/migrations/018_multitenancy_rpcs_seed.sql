-- ============================================================================
-- OP Central — 018: Tenancy RPCs + default-org seed (PHASE 1b — ADDITIVE)
-- ============================================================================
-- Adds the lookup/onboarding RPCs and adopts the CURRENT single-org install as
-- the first tenant, so nothing about today's behaviour changes.
--
-- Still touches NO existing table definition or policy. It only INSERTs into
-- the new 017 tables.
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- 1. Pre-auth org lookup by subdomain.
--    MUST be callable by anon: the login screen needs the org's branding before
--    anybody has signed in. Returns PUBLIC metadata only — never user data.
-- ============================================================================
drop function if exists public.get_organization_by_subdomain(text);
create or replace function public.get_organization_by_subdomain(p_subdomain text)
returns table(id uuid, name text, slug text, subdomain text, status text, branding jsonb)
language sql stable security definer set search_path = public as $fn$
  select o.id, o.name, o.slug, o.subdomain, o.status, o.branding
  from public.organizations o
  where o.subdomain is not null
    and trim(o.subdomain) <> ''
    and lower(trim(o.subdomain)) = lower(trim(coalesce(p_subdomain, '')))
    and o.status = 'active'
  limit 1;
$fn$;
grant execute on function public.get_organization_by_subdomain(text) to anon, authenticated;

-- ============================================================================
-- 2. Which orgs does the logged-in user belong to? (org switcher / post-login)
-- ============================================================================
drop function if exists public.opc_my_organizations();
create or replace function public.opc_my_organizations()
returns table(id uuid, name text, slug text, subdomain text, status text,
              branding jsonb, role text, is_master boolean)
language sql stable security definer set search_path = public as $fn$
  select o.id, o.name, o.slug, o.subdomain, o.status, o.branding,
         coalesce(om.role, 'admin') as role,
         public.is_master_admin() as is_master
  from public.organizations o
  left join public.organization_memberships om
    on om.organization_id = o.id
   and om.user_id = auth.uid()::text
   and om.is_active = true
  where public.is_master_admin() or om.id is not null
  order by o.name;
$fn$;
grant execute on function public.opc_my_organizations() to authenticated;

-- ============================================================================
-- 3. Effective feature map for an org  (missing row => false)
-- ============================================================================
drop function if exists public.opc_org_features(uuid);
create or replace function public.opc_org_features(p_org_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not public.is_org_member(p_org_id) then '{}'::jsonb
    else coalesce(
      (select jsonb_object_agg(f.feature_key, coalesce(f.enabled, false))
       from public.organization_features f
       where f.organization_id = p_org_id),
      '{}'::jsonb)
  end;
$fn$;
grant execute on function public.opc_org_features(uuid) to authenticated;

-- ============================================================================
-- 4. Toggle a capability for an org (org admin or master admin).
-- ============================================================================
create or replace function public.opc_set_org_feature(p_org_id uuid, p_key text, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Only an organization admin can change features';
  end if;
  if coalesce(trim(p_key), '') = '' then
    raise exception 'feature_key is required';
  end if;
  insert into public.organization_features (organization_id, feature_key, enabled, updated_at, updated_by)
  values (p_org_id, trim(p_key), coalesce(p_enabled, false), now(), auth.uid()::text)
  on conflict (organization_id, feature_key)
  do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;
end $fn$;
grant execute on function public.opc_set_org_feature(uuid, text, boolean) to authenticated;

-- ============================================================================
-- 5. Onboarding — one transactional RPC (platform super-admin only).
--    Validates -> inserts org -> upserts first admin membership -> seeds exactly
--    ONE organization_settings row. Deliberately seeds NO feature rows so a new
--    tenant starts with every capability OFF until explicitly enabled.
--
--    It does NOT create the auth user (not reachable from plain SQL here) —
--    it raises a clear error telling the caller to create the login first.
-- ============================================================================
create or replace function public.opc_create_organization(
  p_name          text,
  p_slug          text,
  p_subdomain     text default null,
  p_admin_user_id text default null,
  p_fiscal_year   text default 'FY26'
)
returns table(id uuid, name text, slug text, subdomain text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_id   uuid;
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_sub  text := nullif(lower(trim(coalesce(p_subdomain, ''))), '');
begin
  if not public.is_master_admin() then
    raise exception 'Only a platform super-admin can create organizations';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Organization name is required'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'Slug must be 2-63 chars, lowercase letters/digits/hyphens, starting alphanumeric';
  end if;
  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    raise exception 'Slug "%" is already taken', v_slug;
  end if;

  if v_sub is not null then
    if v_sub !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
      raise exception 'Subdomain must be 2-63 chars, lowercase letters/digits/hyphens, starting alphanumeric';
    end if;
    if exists (select 1 from public.reserved_subdomains r where r.label = v_sub) then
      raise exception 'Subdomain "%" is reserved by the platform', v_sub;
    end if;
    if exists (select 1 from public.organizations o
               where o.subdomain is not null and lower(trim(o.subdomain)) = v_sub) then
      raise exception 'Subdomain "%" is already taken', v_sub;
    end if;
  end if;

  -- The auth user must already exist (create it via the app's admin user flow).
  if p_admin_user_id is not null then
    if not exists (select 1 from public.users u where u.id = p_admin_user_id) then
      raise exception 'No user profile "%". Create the login first (Settings > Users), then re-run with that user id', p_admin_user_id;
    end if;
  end if;

  insert into public.organizations (name, slug, subdomain)
  values (trim(p_name), v_slug, v_sub)
  returning organizations.id into v_id;

  if p_admin_user_id is not null then
    insert into public.organization_memberships (organization_id, user_id, role, is_active)
    values (v_id, p_admin_user_id, 'admin', true)
    on conflict (organization_id, user_id)
    do update set role = 'admin', is_active = true;
  end if;

  -- Exactly one settings row. No feature rows on purpose.
  insert into public.organization_settings (organization_id, fiscal_year)
  values (v_id, coalesce(nullif(trim(p_fiscal_year), ''), 'FY26'))
  on conflict (organization_id) do nothing;

  return query
    select o.id, o.name, o.slug, o.subdomain from public.organizations o where o.id = v_id;
end $fn$;
grant execute on function public.opc_create_organization(text, text, text, text, text) to authenticated;

-- ============================================================================
-- 6. Adopt the CURRENT install as the first tenant.
--    Name comes from the existing org_settings singleton. Subdomain is left
--    NULL on purpose: today's host (ops-central.unimisk.com) is the SHARED
--    host, so nothing about the current deployment changes.
--    All of this is changeable later with a plain UPDATE — see
--    docs/tenant-subdomains.md.
-- ============================================================================
do $seed$
declare
  v_org  uuid;
  v_name text;
begin
  select id into v_org from public.organizations where slug = 'unimisk';

  if v_org is null then
    select coalesce(nullif(trim(org_name), ''), 'UniMisk ERP Solutions')
      into v_name from public.org_settings order by created_at limit 1;
    if v_name is null then v_name := 'UniMisk ERP Solutions'; end if;

    insert into public.organizations (name, slug, subdomain)
    values (v_name, 'unimisk', null)
    returning id into v_org;
  end if;

  insert into public.organization_settings (organization_id, fiscal_year)
  values (v_org, coalesce((select nullif(trim(fiscal_year), '') from public.org_settings order by created_at limit 1), 'FY26'))
  on conflict (organization_id) do nothing;

  -- Every existing user becomes a member of the default org so that when
  -- Phase 3 flips the policies, nobody loses access.
  insert into public.organization_memberships (organization_id, user_id, role, is_active)
  select v_org, u.id,
         case when u.role = 'Org Admin' then 'admin' else 'member' end,
         coalesce(u.active, true)
  from public.users u
  on conflict (organization_id, user_id) do nothing;

  -- Existing Org Admins also become platform super-admins, otherwise there
  -- would be nobody able to onboard the next tenant.
  insert into public.master_admin_memberships (user_id, granted_by)
  select u.id, 'migration-018'
  from public.users u
  where u.role = 'Org Admin' and coalesce(u.active, true)
  on conflict (user_id) do nothing;
end $seed$;

notify pgrst, 'reload schema';
