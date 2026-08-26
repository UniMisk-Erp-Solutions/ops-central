-- ============================================================================
-- OP Central — 020: Phase 3 PREP (still ADDITIVE — nothing is enforced yet)
-- ============================================================================
-- Everything Phase 3 needs, added BEFORE the policy switch so each piece can be
-- deployed and verified independently:
--
--   * shares_org_with()      — for the tenant-scoped users policy (no recursion)
--   * one config row per org — unique index + opc_get_config / opc_save_config
--   * org_id_of_sourcing()   — lets the edge function stamp rfqs server-side
--
-- No policy is changed and no column is made NOT NULL here.
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- 1. Do two users share an org?  (SECURITY DEFINER -> bypasses RLS on
--    organization_memberships, so the users policy cannot recurse.)
-- ============================================================================
create or replace function public.shares_org_with(p_user_id text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select
    public.is_master_admin()
    or p_user_id = auth.uid()::text
    or exists (
      select 1
      from public.organization_memberships a
      join public.organization_memberships b
        on b.organization_id = a.organization_id
      where a.user_id = auth.uid()::text and a.is_active = true
        and b.user_id = p_user_id and b.is_active = true
    );
$fn$;
grant execute on function public.shares_org_with(text) to authenticated;

-- ============================================================================
-- 2. Config: exactly ONE row per organization.
--    The existing row keeps id='singleton' (default org) so nothing breaks;
--    new orgs get their own row keyed by the org uuid.
-- ============================================================================
create unique index if not exists idx_config_one_per_org
  on public.config (organization_id)
  where organization_id is not null;

-- Read the caller's own org config. Returns '{}' when there is none yet.
create or replace function public.opc_get_config()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select c.data from public.config c
      where c.organization_id = public.default_org_id()
      limit 1),
    '{}'::jsonb);
$fn$;
grant execute on function public.opc_get_config() to authenticated;

-- Write the caller's own org config. The org is derived server-side from
-- auth.uid() — it is NEVER accepted from the client.
create or replace function public.opc_save_config(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid := public.default_org_id();
  v_id  text;
begin
  if v_org is null then
    raise exception 'You do not belong to an organization';
  end if;
  if not public.is_org_member(v_org) then
    raise exception 'Not a member of this organization';
  end if;

  select c.id into v_id from public.config c where c.organization_id = v_org limit 1;
  if v_id is null then
    -- Preserve the historical 'singleton' id when it is free (default org),
    -- otherwise key the row by the org uuid.
    if not exists (select 1 from public.config c where c.id = 'singleton') then
      v_id := 'singleton';
    else
      v_id := v_org::text;
    end if;
    insert into public.config (id, data, organization_id, updated_at)
    values (v_id, coalesce(p_data, '{}'::jsonb), v_org, now());
  else
    update public.config
       set data = coalesce(p_data, '{}'::jsonb), updated_at = now()
     where id = v_id;
  end if;

  return (select c.data from public.config c where c.id = v_id);
end $fn$;
grant execute on function public.opc_save_config(jsonb) to authenticated;

-- ============================================================================
-- 3. Which org does a sourcing belong to?
--    The edge function runs with the service key, so auth.uid() is NULL and the
--    column DEFAULT default_org_id() cannot apply. It uses this to stamp the
--    rfqs row it creates — derived from the parent sourcing, never from the
--    request body.
-- ============================================================================
create or replace function public.org_id_of_sourcing(p_src_id text)
returns uuid language sql stable security definer set search_path = public as $fn$
  select s.organization_id from public.sourcings s where s.id = p_src_id limit 1;
$fn$;
grant execute on function public.org_id_of_sourcing(text) to authenticated, service_role;

notify pgrst, 'reload schema';
