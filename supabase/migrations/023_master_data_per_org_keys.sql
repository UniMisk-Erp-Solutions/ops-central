-- ============================================================================
-- OP Central — 023: make master-data keys PER-ORG (prevents a future collision)
-- ============================================================================
-- Master data (products / categories / boms) is per-organization, but their keys
-- were still GLOBAL:
--
--   categories.id           PK (id)             -> two orgs cannot both use 'cat-server'
--   products.id             PK (id)             -> two orgs cannot both use 'p-cpu-i7'
--   boms.category_id        PK (category_id)    -> only ONE org could own a BOM per category
--
-- Every org seeds the same catalogue ids, so the second tenant to write master
-- data would have hit a primary-key violation. Nothing breaks today because the
-- app serves master data from seed.js and never reads/writes these tables — this
-- closes the trap before anyone does.
--
-- Keys become (organization_id, <id>), so each tenant owns an independent
-- catalogue and identical ids across orgs are fine.
-- Idempotent / re-runnable.
-- ============================================================================

do $mig$
begin
  -- Guard: organization_id must exist and be populated (added in 019).
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='categories' and column_name='organization_id') then
    raise exception 'run 019 first (categories.organization_id missing)';
  end if;
  if exists (select 1 from public.categories where organization_id is null)
     or exists (select 1 from public.products where organization_id is null)
     or exists (select 1 from public.boms where organization_id is null) then
    raise exception 'ABORT: master data has rows without organization_id';
  end if;

  -- 1. drop the dependent FK first
  if exists (select 1 from pg_constraint where conname='boms_category_id_fkey') then
    alter table public.boms drop constraint boms_category_id_fkey;
  end if;

  -- 2. categories: PK (id) -> (organization_id, id)
  if exists (select 1 from pg_constraint where conname='categories_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') then
    alter table public.categories drop constraint categories_pkey;
    alter table public.categories add constraint categories_pkey primary key (organization_id, id);
  end if;

  -- 3. products: PK (id) -> (organization_id, id)
  if exists (select 1 from pg_constraint where conname='products_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') then
    alter table public.products drop constraint products_pkey;
    alter table public.products add constraint products_pkey primary key (organization_id, id);
  end if;

  -- 4. boms: PK (category_id) -> (organization_id, category_id)
  if exists (select 1 from pg_constraint where conname='boms_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (category_id)') then
    alter table public.boms drop constraint boms_pkey;
    alter table public.boms add constraint boms_pkey primary key (organization_id, category_id);
  end if;

  -- 5. re-create the FK, now org-aware: a BOM can only point at a category
  --    belonging to the SAME organization.
  if not exists (select 1 from pg_constraint where conname='boms_category_org_fkey') then
    alter table public.boms
      add constraint boms_category_org_fkey
      foreign key (organization_id, category_id)
      references public.categories (organization_id, id) on delete cascade;
  end if;
end $mig$;

notify pgrst, 'reload schema';
