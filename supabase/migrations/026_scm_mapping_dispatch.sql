-- ============================================================================
-- OP Central — 026: item name mapping + outward dispatch + in-transit tracking
-- ============================================================================
-- Two capabilities, both per-organization and both additive:
--
-- (A) THE 3-NAME CHAIN.  One physical item carries three names:
--       customer's name  ->  OUR item  ->  vendor's part number
--     item_aliases stores the outer two against our internal product id, keyed
--     by the party (customer or vendor). Learned once, reused forever, so with
--     10 000+ vendors the second PO to a vendor auto-fills.
--
-- (B) OUTWARD DISPATCH.  Stock leaves the Virtual Godown to the customer, in
--     partial quantities, per line, with a printable delivery challan. A line
--     can therefore be "received 10" AND "dispatched 5" at the same time.
--
-- Plus in-transit (LR / tracking) on the vendor PO, between PO and GRN.
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- A. item_aliases — the name mapping
-- ============================================================================
create table if not exists public.item_aliases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade
                    default public.active_org_id(),
  product_id      text not null,              -- OUR internal item id
  scope           text not null check (scope in ('customer','vendor')),
  party_id        text,                       -- customer_id / vendor_id; null = generic
  alias_code      text,                       -- their part number
  alias_name      text,                       -- their description
  uom             text,                       -- their unit, if it differs
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- one alias per (org, item, scope, party)
create unique index if not exists idx_item_aliases_unique
  on public.item_aliases (organization_id, product_id, scope, coalesce(party_id, ''));

-- fast forward lookup: "give me this vendor's names for these items"
create index if not exists idx_item_aliases_party
  on public.item_aliases (organization_id, scope, party_id);

-- fast REVERSE lookup: "an imported sheet says C9606R — which of our items is it?"
create index if not exists idx_item_aliases_code
  on public.item_aliases (organization_id, scope, lower(alias_code));
create index if not exists idx_item_aliases_name
  on public.item_aliases (organization_id, scope, lower(alias_name));

alter table public.item_aliases enable row level security;
revoke all on public.item_aliases from anon;
grant select, insert, update, delete on public.item_aliases to authenticated;
drop policy if exists tenant_all_item_aliases on public.item_aliases;
create policy tenant_all_item_aliases on public.item_aliases for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Learn/refresh one mapping.
create or replace function public.opc_alias_set(
  p_product_id text, p_scope text, p_party_id text,
  p_alias_code text, p_alias_name text, p_uom text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.active_org_id();
begin
  if v_org is null or not public.is_org_member(v_org) then raise exception 'No active organization'; end if;
  if p_scope not in ('customer','vendor') then raise exception 'scope must be customer or vendor'; end if;
  if coalesce(trim(p_product_id),'') = '' then raise exception 'product_id is required'; end if;

  insert into public.item_aliases (organization_id, product_id, scope, party_id,
                                   alias_code, alias_name, uom, created_by)
  values (v_org, p_product_id, p_scope, nullif(trim(coalesce(p_party_id,'')),''),
          nullif(trim(coalesce(p_alias_code,'')),''), nullif(trim(coalesce(p_alias_name,'')),''),
          nullif(trim(coalesce(p_uom,'')),''), auth.uid()::text)
  on conflict (organization_id, product_id, scope, coalesce(party_id, ''))
  do update set alias_code = excluded.alias_code,
                alias_name = excluded.alias_name,
                uom        = coalesce(excluded.uom, public.item_aliases.uom),
                updated_at = now();

  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'scope', p_scope);
end $fn$;
grant execute on function public.opc_alias_set(text, text, text, text, text, text) to authenticated;

-- Every alias for one party, as { product_id: {code, name, uom} }.
create or replace function public.opc_alias_map(p_scope text, p_party_id text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_object_agg(a.product_id,
           jsonb_build_object('code', a.alias_code, 'name', a.alias_name, 'uom', a.uom)), '{}'::jsonb)
  from public.item_aliases a
  where a.organization_id = public.active_org_id()
    and a.scope = p_scope
    and (a.party_id is not distinct from nullif(trim(coalesce(p_party_id,'')),''));
$fn$;
grant execute on function public.opc_alias_map(text, text) to authenticated;

-- Reverse: match an imported code/description back to OUR item.
-- Tries, in order: exact alias code -> exact alias name -> our product code -> our product name.
create or replace function public.opc_alias_resolve(p_scope text, p_party_id text, p_code text, p_name text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with org as (select public.active_org_id() as id),
  hit as (
    select a.product_id, 'alias_code' as how, 1 as rank from public.item_aliases a, org
      where a.organization_id = org.id and a.scope = p_scope
        and (a.party_id is not distinct from nullif(trim(coalesce(p_party_id,'')),''))
        and p_code is not null and lower(a.alias_code) = lower(trim(p_code))
    union all
    select a.product_id, 'alias_name', 2 from public.item_aliases a, org
      where a.organization_id = org.id and a.scope = p_scope
        and (a.party_id is not distinct from nullif(trim(coalesce(p_party_id,'')),''))
        and p_name is not null and lower(a.alias_name) = lower(trim(p_name))
    union all
    select p.id, 'our_code', 3 from public.products p, org
      where p.organization_id = org.id and p_code is not null and lower(p.code) = lower(trim(p_code))
    union all
    select p.id, 'our_name', 4 from public.products p, org
      where p.organization_id = org.id and p_name is not null and lower(p.name) = lower(trim(p_name))
  )
  select coalesce((select jsonb_build_object('product_id', product_id, 'matched_by', how)
                   from hit order by rank limit 1), '{}'::jsonb);
$fn$;
grant execute on function public.opc_alias_resolve(text, text, text, text) to authenticated;

-- ============================================================================
-- B. outward_dispatches — stock leaving the VG for the customer
-- ============================================================================
create table if not exists public.outward_dispatches (
  id              text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade
                    default public.active_org_id(),
  so_id           text not null,
  dc_no           text,
  date            date not null default current_date,
  items           jsonb not null default '[]'::jsonb,  -- [{product_id,name,code,qty}]
  transport       jsonb not null default '{}'::jsonb,  -- {mode,vehicle,lr,carrier,tracking,contact,notes}
  status          text not null default 'Dispatched',  -- Dispatched | Delivered | Cancelled
  created_by      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_outward_so  on public.outward_dispatches (so_id);
create index if not exists idx_outward_org on public.outward_dispatches (organization_id);

alter table public.outward_dispatches enable row level security;
revoke all on public.outward_dispatches from anon;
grant select, insert, update, delete on public.outward_dispatches to authenticated;
drop policy if exists tenant_all_outward_dispatches on public.outward_dispatches;
create policy tenant_all_outward_dispatches on public.outward_dispatches for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ============================================================================
-- C. In-transit (LR / tracking) on the vendor PO — between PO and GRN
-- ============================================================================
alter table public.vendor_pos add column if not exists dispatch_info jsonb not null default '{}'::jsonb;
-- { shipped_on, lr_no, carrier, tracking_url, contact, eta, notes, items:[{product_id,qty}] }

notify pgrst, 'reload schema';
