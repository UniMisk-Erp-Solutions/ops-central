-- ============================================================================
-- OP Central — 019: organization_id on tenant tables (PHASE 2)
-- ============================================================================
-- Adds a NULLABLE organization_id to every tenant-owned table, backfills it to
-- the default org, indexes it, and gives it a DEFAULT of public.default_org_id()
-- so rows inserted from now on are stamped automatically.
--
-- Why this is NON-BREAKING:
--   * the column is nullable and NOT yet enforced by any policy
--   * existing policies (member_all_*) are untouched, so reads/writes behave
--     exactly as they do today
--   * the DEFAULT means the app keeps working without any frontend change, and
--     new rows are already tenant-stamped ready for Phase 3
--
-- Phase 3 (separate, scheduled) is what actually enforces isolation:
--   set NOT NULL + swap member_all_* for tenant-scoped policies.
-- Idempotent / re-runnable.
-- ============================================================================

do $mig$
declare
  t     text;
  v_org uuid;
  -- Tenant-owned transactional data.
  tenant_tables text[] := array[
    'sales_orders','vendor_pos','grns','vendor_invoices','payments',
    'sourcings','rfqs','transfer_requests','pool',
    'customers','vendors','notifications','audit'
  ];
  -- Master data. Per the platform decision these are PER-ORG (each tenant keeps
  -- its own catalogue), so they are scoped exactly like transactional tables.
  master_tables text[] := array['products','categories','boms'];
  all_tables    text[];
begin
  all_tables := tenant_tables || master_tables;

  select id into v_org from public.organizations where slug = 'unimisk';
  if v_org is null then
    raise exception 'Default organization (slug=unimisk) not found — run 018 first';
  end if;

  foreach t in array all_tables loop
    -- Skip tables that do not exist in this install rather than failing.
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'skipping %, table not present', t;
      continue;
    end if;

    -- 1. column
    execute format('alter table public.%I add column if not exists organization_id uuid', t);

    -- 2. FK (cascade: child data is meaningless without its org)
    if not exists (
      select 1 from pg_constraint
      where conname = t || '_organization_id_fkey'
        and conrelid = format('public.%I', t)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (organization_id) '
        || 'references public.organizations(id) on delete cascade',
        t, t || '_organization_id_fkey');
    end if;

    -- 3. backfill existing rows to the default org
    execute format('update public.%I set organization_id = %L where organization_id is null', t, v_org);

    -- 4. index for the tenant-scoped policies that arrive in Phase 3
    execute format('create index if not exists %I on public.%I (organization_id)',
                   'idx_' || t || '_org', t);

    -- 5. auto-stamp future inserts with the caller's org (no frontend change
    --    needed). Server-derived from auth.uid() — never client input.
    execute format('alter table public.%I alter column organization_id set default public.default_org_id()', t);
  end loop;
end $mig$;

-- ----------------------------------------------------------------------------
-- config: the app's control plane is a single row (id='singleton') holding
-- permissions / vendor_emails / custom_products. Give it an organization_id too
-- so Phase 3 can split it per tenant (one config row per org) without a second
-- migration. Left nullable + backfilled; the singleton keeps working untouched.
-- ----------------------------------------------------------------------------
do $cfg$
declare v_org uuid;
begin
  select id into v_org from public.organizations where slug = 'unimisk';
  if v_org is null then return; end if;

  alter table public.config add column if not exists organization_id uuid;

  if not exists (
    select 1 from pg_constraint
    where conname = 'config_organization_id_fkey'
      and conrelid = 'public.config'::regclass
  ) then
    alter table public.config
      add constraint config_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;

  update public.config set organization_id = v_org where organization_id is null;
  create index if not exists idx_config_org on public.config (organization_id);
end $cfg$;

notify pgrst, 'reload schema';
