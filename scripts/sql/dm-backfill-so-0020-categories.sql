-- ============================================================================
-- Demo Org — backfill SO/FY26/0020 (so-1790152650368), converted from
-- CREQ202605002 before the category_id / unit_price fix landed
-- ============================================================================
-- ClientRequestDetail.convert() used to write lines with no category_id and
-- unit_price: 0. screens-so.jsx's Line Items tab calls
-- getCategory(l.category_id).name unconditionally -- this order's lines had
-- none, so opening that tab crashed ("Cannot read properties of undefined
-- (reading 'name')"), and _soBilled (screens-billing.jsx) read unit_price, so
-- the order could never be invoiced either. This is a one-time repair for the
-- one order that predates the fix; every conversion from here on creates its
-- own category/BOM correctly. See docs/client-requests.md.
-- ============================================================================

do $$
declare
  org uuid := (select id from public.organizations where slug = 'demo');
  so_row jsonb;
  new_lines jsonb := '[]'::jsonb;
  ln jsonb;
  label text;
  cat_id text;
  comp jsonb;
  comp_qty numeric;
  comp_sell numeric;
  unit_price numeric;
begin
  if org is null then raise exception 'Demo Org (slug=demo) not found'; end if;

  select lines into so_row from public.sales_orders where id = 'so-1790152650368' and organization_id = org;
  if so_row is null then raise notice 'so-1790152650368 not found -- nothing to backfill'; return; end if;

  for ln in select * from jsonb_array_elements(so_row) loop
    label := trim(both from (ln->'components'->0->>'product_id'));  -- placeholder, replaced below
    label := trim(both from (ln->>'client_name'));
    comp := ln->'components'->0;
    comp_qty := coalesce((comp->>'qty')::numeric, 0);
    comp_sell := coalesce((comp->>'sell')::numeric, 0);
    unit_price := comp_qty * comp_sell;

    select id into cat_id from public.categories
      where organization_id = org and lower(name) = lower(label) limit 1;
    if cat_id is null then
      cat_id := 'cat-creq-fix-' || (ln->>'id');
      insert into public.categories (id, organization_id, name, hsn, gst, bundle_desc)
      values (cat_id, org, label, '', 18, label)
      on conflict (organization_id, id) do nothing;
      insert into public.boms (organization_id, category_id, components)
      values (org, cat_id, jsonb_build_array(jsonb_build_object(
        'product_id', comp->>'product_id', 'qty', comp_qty)))
      on conflict (organization_id, category_id) do nothing;
    end if;

    new_lines := new_lines || jsonb_build_array(
      (ln - 'category_id' - 'unit_price') || jsonb_build_object('category_id', cat_id, 'unit_price', unit_price));
  end loop;

  update public.sales_orders set lines = new_lines
   where id = 'so-1790152650368' and organization_id = org;
end $$;

select id, so_no, jsonb_path_query_array(lines, '$[*].category_id') as category_ids,
  jsonb_path_query_array(lines, '$[*].unit_price') as unit_prices
from public.sales_orders where id = 'so-1790152650368';
