-- ============================================================================
-- Demo Org — link a vendor-comparison Sourcing record to SO/FY26/0020
-- ============================================================================
-- so-1790152650368 was converted before Float RFQ existed on this tenant at
-- all. Every conversion from here on creates this record automatically
-- (ClientRequestDetail.convert(), screens-client-requests.jsx) — this is a
-- one-time backfill for the one order that predates it. See
-- docs/so-float-rfq.md.
-- ============================================================================

do $$
declare
  org uuid := (select id from public.organizations where slug = 'demo');
  so_lines jsonb;
begin
  if org is null then raise exception 'Demo Org (slug=demo) not found'; end if;
  select lines into so_lines from public.sales_orders
   where id = 'so-1790152650368' and organization_id = org;
  if so_lines is null then raise notice 'so-1790152650368 not found -- nothing to backfill'; return; end if;

  insert into public.sourcings (id, organization_id, src_no, customer_id, ref, date, status,
    client_req_price, our_price, notes, created_by,
    lines, picks, prices, alloc, margin, quote_vendors, converted_so_id)
  values (
    'src-creq-fix-1790152650368', org, 'INQ/FY26/0001', 'c-dm-02', 'CREQ202605002', current_date, 'Vendor Sourcing',
    null, null, 'Vendor comparison for SO/FY26/0020 — from CREQ202605002', null,
    so_lines, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'so-1790152650368'
  )
  on conflict (id) do nothing;
end $$;

select id, src_no, status, converted_so_id from public.sourcings where id = 'src-creq-fix-1790152650368';
