-- ============================================================================
-- OP Central — 029: batch item matching for the sheet import
-- ============================================================================
-- The importer resolved one row at a time and awaited each call, so a 500-line
-- BOQ meant 500 sequential round trips over a Cloudflare tunnel — minutes of
-- waiting for work the database does in milliseconds. Writing the learned
-- aliases back did the same thing again.
--
-- These do the identical matching, set-based, in ONE call each. The ranking is
-- unchanged (alias code -> alias name -> our code -> our name), so a sheet
-- matches exactly as it did before — only faster.
-- ============================================================================

-- Resolve many rows at once.
--   p_rows: [{"k":"r12","code":"C9606R","name":"…"}, …]
--   returns {"r12": {"product_id":"p-…","matched_by":"alias_code"}, …}
create or replace function public.opc_alias_resolve_bulk(
  p_scope text, p_party_id text, p_rows jsonb)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with org as (select public.active_org_id() as id),
  input as (
    select r->>'k'    as k,
           nullif(trim(r->>'code'), '') as code,
           nullif(trim(r->>'name'), '') as name
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  ),
  party as (select nullif(trim(coalesce(p_party_id, '')), '') as id),
  hit as (
    -- 1. this party's own part number
    select i.k, a.product_id, 'alias_code' as how, 1 as rank
      from input i join org on true join party on true
      join public.item_aliases a
        on a.organization_id = org.id and a.scope = p_scope
       and (a.party_id is not distinct from party.id)
       and i.code is not null and lower(a.alias_code) = lower(i.code)
    union all
    -- 2. this party's own wording
    select i.k, a.product_id, 'alias_name', 2
      from input i join org on true join party on true
      join public.item_aliases a
        on a.organization_id = org.id and a.scope = p_scope
       and (a.party_id is not distinct from party.id)
       and i.name is not null and lower(a.alias_name) = lower(i.name)
    union all
    -- 3. our own code
    select i.k, p.id, 'our_code', 3
      from input i join org on true
      join public.products p
        on p.organization_id = org.id
       and i.code is not null and lower(p.code) = lower(i.code)
    union all
    -- 4. our own name
    select i.k, p.id, 'our_name', 4
      from input i join org on true
      join public.products p
        on p.organization_id = org.id
       and i.name is not null and lower(p.name) = lower(i.name)
  ),
  best as (
    select distinct on (k) k, product_id, how
      from hit order by k, rank, product_id
  )
  select coalesce(
    (select jsonb_object_agg(k, jsonb_build_object('product_id', product_id, 'matched_by', how))
       from best), '{}'::jsonb);
$fn$;
grant execute on function public.opc_alias_resolve_bulk(text, text, jsonb) to authenticated;

-- Learn many mappings at once.
--   p_rows: [{"product_id":"p-…","code":"C9606R","name":"…","uom":"Nos."}, …]
create or replace function public.opc_alias_set_bulk(
  p_scope text, p_party_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.active_org_id();
        v_party text := nullif(trim(coalesce(p_party_id, '')), '');
        v_count int := 0;
begin
  if v_org is null or not public.is_org_member(v_org) then raise exception 'No active organization'; end if;
  if p_scope not in ('customer', 'vendor') then raise exception 'scope must be customer or vendor'; end if;

  -- One sheet can legitimately list the same item twice (a real BOQ has
  -- C9600-SSD-NONE on two rows). DISTINCT ON keeps one row per item, because a
  -- single INSERT that hits the same unique key twice cannot be resolved by
  -- ON CONFLICT and would abort the whole statement.
  insert into public.item_aliases (organization_id, product_id, scope, party_id,
                                   alias_code, alias_name, uom, created_by)
  select v_org, d.product_id, p_scope, v_party, d.code, d.name, d.uom, auth.uid()::text
    from (
      select distinct on (r->>'product_id')
             r->>'product_id'            as product_id,
             nullif(trim(r->>'code'), '') as code,
             nullif(trim(r->>'name'), '') as name,
             nullif(trim(r->>'uom'), '')  as uom
        from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
       where nullif(trim(r->>'product_id'), '') is not null
       order by r->>'product_id'
    ) d
  on conflict (organization_id, product_id, scope, coalesce(party_id, ''))
  do update set alias_code = excluded.alias_code,
                alias_name = excluded.alias_name,
                uom = coalesce(excluded.uom, public.item_aliases.uom),
                updated_at = now();

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'count', v_count);
end $fn$;
grant execute on function public.opc_alias_set_bulk(text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
