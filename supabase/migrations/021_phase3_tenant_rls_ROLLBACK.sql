-- ============================================================================
-- OP Central — ROLLBACK for 021 (Phase 3 tenant isolation)
-- ============================================================================
-- Restores the pre-Phase-3 behaviour: any active member can read/write every
-- row again (tenant-blind), and organization_id goes back to nullable.
--
-- Data is NOT touched — organization_id values are left in place, so re-running
-- 021 afterwards is a clean forward step.
--
-- Run with:  scripts/ssh-rollback-phase3.py
-- Idempotent / re-runnable.
-- ============================================================================

do $rb$
declare
  t text;
  scoped text[] := array[
    'sales_orders','vendor_pos','grns','vendor_invoices','payments',
    'sourcings','rfqs','transfer_requests','pool',
    'customers','vendors','notifications','audit',
    'products','categories','boms'
  ];
begin
  foreach t in array scoped loop
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=t) then
      continue;
    end if;

    -- back to nullable
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name=t and column_name='organization_id') then
      execute format('alter table public.%I alter column organization_id drop not null', t);
    end if;

    -- tenant-scoped policy out, tenant-blind policy back in
    execute format('drop policy if exists %I on public.%I;', 'tenant_all_' || t, t);
    execute format('drop policy if exists %I on public.%I;', 'member_all_' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.is_member()) with check (public.is_member());',
      'member_all_' || t, t);
  end loop;
end $rb$;

-- config: back to member-read / admin-write (tenant-blind)
drop policy if exists config_read  on public.config;
drop policy if exists config_write on public.config;
create policy config_read  on public.config for select to authenticated using (public.is_member());
create policy config_write on public.config for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- users: back to member-read / admin-write (tenant-blind)
drop policy if exists users_read  on public.users;
drop policy if exists users_write on public.users;
create policy users_read  on public.users for select to authenticated using (public.is_member());
create policy users_write on public.users for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
