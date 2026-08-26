-- ============================================================================
-- OP Central — 017: Multi-tenancy foundation (PHASE 1 — purely ADDITIVE)
-- ============================================================================
-- Creates the tenancy control plane. It does NOT touch any existing table,
-- column, policy or grant, so the running app is completely unaffected.
--
--   organizations                — one row per tenant (slug + optional subdomain)
--   organization_memberships     — user <-> org (THE security boundary)
--   organization_features        — binary capability toggles (default OFF)
--   organization_settings        — parameters that tune an ACTIVE capability
--   master_admin_memberships     — platform super-admins (bypass tenant RLS)
--   reserved_subdomains          — labels tenants may never claim
--
-- Conventions kept from this codebase (do not "fix" these):
--   * public.users.id is TEXT holding the auth uuid  -> memberships.user_id TEXT
--   * helper fns are SECURITY DEFINER so they bypass RLS and cannot recurse
--   * everything is idempotent / re-runnable
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. Tenants
-- ============================================================================
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,               -- url-safe id, uniqueness/display
  subdomain   text,                               -- routing key; NULL/'' = shared host
  status      text not null default 'active',     -- active | suspended
  branding    jsonb not null default '{}'::jsonb, -- logo/colour/login copy (public)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Case-insensitive PARTIAL unique index: many orgs may have no subdomain
-- (they live on the shared/generic host) but two orgs can never collide.
create unique index if not exists idx_orgs_subdomain_lower_unique
  on public.organizations (lower(trim(subdomain)))
  where subdomain is not null and trim(subdomain) <> '';

create index if not exists idx_orgs_status on public.organizations (status);

-- Labels a tenant may never take (backend hosts, app hosts, common infra).
-- A TABLE (not a hardcoded list) so it stays changeable without a code deploy.
create table if not exists public.reserved_subdomains (
  label text primary key
);
insert into public.reserved_subdomains (label) values
  ('www'),('api'),('app'),('admin'),('auth'),('mail'),('smtp'),('ftp'),('cdn'),
  ('static'),('assets'),('status'),('health'),('dashboard'),('portal'),('login'),
  ('signup'),('billing'),('support'),('docs'),('blog'),('dev'),('staging'),('test'),
  ('so-po'),('ops-central'),('supabase'),('db'),('storage'),('functions'),('quote')
on conflict (label) do nothing;

-- ============================================================================
-- 2. Membership — the ACTUAL security boundary (never the hostname)
-- ============================================================================
create table if not exists public.organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         text not null,                  -- matches public.users.id (auth uuid as text)
  role            text not null default 'member', -- admin | member (app roles stay in public.users.role)
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists idx_memberships_user on public.organization_memberships (user_id) where is_active;
create index if not exists idx_memberships_org  on public.organization_memberships (organization_id) where is_active;

-- ============================================================================
-- 3. Platform super-admins (not scoped to any org; bypass tenant RLS)
-- ============================================================================
create table if not exists public.master_admin_memberships (
  user_id    text primary key,
  granted_at timestamptz not null default now(),
  granted_by text
);

-- ============================================================================
-- 4. Per-org capability toggles  (NO row => OFF, via coalesce(enabled,false))
--    Deliberately NOT seeded on onboarding: a new org starts with nothing on.
-- ============================================================================
create table if not exists public.organization_features (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key     text not null,
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      text,
  primary key (organization_id, feature_key)
);

-- ============================================================================
-- 5. Per-org settings — parameters that TUNE an already-active capability.
--    Separate from features on purpose (booleans vs configuration).
--    `data` mirrors this app's existing config.data jsonb shape (permissions,
--    vendor_emails, custom_products, ...) so Phase 3 can move it per-org.
-- ============================================================================
create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  fiscal_year     text not null default 'FY26',
  currency        text not null default 'INR',
  timezone        text not null default 'Asia/Kolkata',
  data            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

-- ============================================================================
-- 6. Helper functions (SECURITY DEFINER -> bypass RLS, no policy recursion)
-- ============================================================================
create or replace function public.is_master_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.master_admin_memberships m where m.user_id = auth.uid()::text
  );
$fn$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_org_id is not null and (
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
  select p_org_id is not null and (
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

-- Every org the caller may see (used by policies + the frontend org switcher).
create or replace function public.current_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select o.id from public.organizations o where public.is_master_admin()
  union
  select om.organization_id from public.organization_memberships om
  where om.user_id = auth.uid()::text and om.is_active = true;
$fn$;

-- The tenant a new row should be stamped with (caller's primary org).
create or replace function public.default_org_id()
returns uuid language sql stable security definer set search_path = public as $fn$
  select om.organization_id from public.organization_memberships om
  where om.user_id = auth.uid()::text and om.is_active = true
  order by om.created_at limit 1;
$fn$;

grant execute on function public.is_master_admin()   to anon, authenticated;
grant execute on function public.is_org_member(uuid) to anon, authenticated;
grant execute on function public.is_org_admin(uuid)  to anon, authenticated;
grant execute on function public.current_org_ids()   to authenticated;
grant execute on function public.default_org_id()    to authenticated;

-- ============================================================================
-- 7. RLS on the new tables
-- ============================================================================
alter table public.organizations             enable row level security;
alter table public.organization_memberships  enable row level security;
alter table public.organization_features     enable row level security;
alter table public.organization_settings     enable row level security;
alter table public.master_admin_memberships  enable row level security;
alter table public.reserved_subdomains       enable row level security;

revoke all on public.organizations            from anon;
revoke all on public.organization_memberships from anon;
revoke all on public.organization_features    from anon;
revoke all on public.organization_settings    from anon;
revoke all on public.master_admin_memberships from anon, authenticated;
revoke all on public.reserved_subdomains      from anon;

grant select on public.organizations                         to authenticated;
grant select on public.organization_memberships              to authenticated;
grant select on public.organization_features                 to authenticated;
grant select on public.organization_settings                 to authenticated;
grant select on public.reserved_subdomains                   to authenticated;
grant insert, update, delete on public.organization_features to authenticated;
grant insert, update, delete on public.organization_settings to authenticated;

drop policy if exists orgs_read on public.organizations;
create policy orgs_read on public.organizations for select to authenticated
  using (public.is_org_member(id));
drop policy if exists orgs_write on public.organizations;
create policy orgs_write on public.organizations for all to authenticated
  using (public.is_master_admin()) with check (public.is_master_admin());

drop policy if exists memberships_read on public.organization_memberships;
create policy memberships_read on public.organization_memberships for select to authenticated
  using (user_id = auth.uid()::text or public.is_org_admin(organization_id));
drop policy if exists memberships_write on public.organization_memberships;
create policy memberships_write on public.organization_memberships for all to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists features_read on public.organization_features;
create policy features_read on public.organization_features for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists features_write on public.organization_features;
create policy features_write on public.organization_features for all to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists settings_read on public.organization_settings;
create policy settings_read on public.organization_settings for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists settings_write on public.organization_settings;
create policy settings_write on public.organization_settings for all to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists reserved_read on public.reserved_subdomains;
create policy reserved_read on public.reserved_subdomains for select to authenticated using (true);

-- master_admin_memberships: no client writes at all (SQL / SECURITY DEFINER only).
drop policy if exists master_admin_none on public.master_admin_memberships;
create policy master_admin_none on public.master_admin_memberships for select to authenticated
  using (public.is_master_admin());

notify pgrst, 'reload schema';
